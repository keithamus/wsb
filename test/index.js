#!/usr/bin/env node
const axios = require("axios").default;
const getPort = require("get-port");
const test = require("ava");
const tmp = require("tmp");
const { fork } = require("child_process");
const { join } = require("path");
const { readFileSync, unlinkSync, writeFileSync } = require("fs");

tmp.setGracefulCleanup();

test.beforeEach((t) => {
  const tmpDirObject = tmp.dirSync();
  t.context.tmpDirObject = tmpDirObject;
  t.context.tmpDir = tmpDirObject.name;
});

test.afterEach((t) => {
  t.context.tmpDirObject.removeCallback();
});

async function sleep(n) {
  await new Promise((r) => setTimeout(r, n));
}

async function retryUntilSuccess(cb) {
  while (true) {
    try {
      return await cb()
    } catch(e) {
      // ignore
    }
  }
}

async function withWsb(args, run) {
  const port = await getPort();
  const tmpDir = tmp.dirSync();

  const proc = fork(join(__dirname, "..", "index.js"), ["-p", port, ...args]);

  const requestFile = (path, options = {}) => {
    return axios
      .get(`http://localhost:${port}/${path}`, options)
      .catch((error) => {
        // Return 4xx/5xx to the test itself
        if (error.response) return error.response;

        throw error;
      });
  };

  // let server start
  await retryUntilSuccess(() => {
    return requestFile('/wait-until-the-server-loads')
  })

  try {
    await run(requestFile);
  } finally {
    proc.kill();

    // let server finish
    await retryUntilSuccess(() => {
      return requestFile('/wait-until-the-server-loads').then(
        () => { throw new Error("Still running") },
        () => "Closed"
      )
    })
  }
}

/**
 * Lookup a raw header by name from an axios response object.
 *
 * Will include headers that axios strips from response.headers, like 'Content-Encoding'
 */
function getRawHeader(response, headerName) {
  const { rawHeaders } = response.request.res;
  const nameIndex = rawHeaders.indexOf(headerName);
  if (nameIndex === -1) {
    return;
  }
  return rawHeaders[nameIndex + 1];
}

test("Serves static assets", async (t) => {
  await withWsb(["--static", t.context.tmpDir], async (requestFile) => {
    let response;

    writeFileSync(join(t.context.tmpDir, "foo.html"), "foo-contents");

    /**
     * 1. file exists
     */
    response = await requestFile("foo.html");
    t.is(response.status, 200);
    t.is("foo-contents", response.data);

    /**
     * 2. file does not exist
     */
    response = await requestFile("does-not-exist.html");
    t.is(response.status, 404);
    t.regex(response.data, /no such file or directory/);
  });
});

test("Serves compressed assets", async (t) => {
  await withWsb(
    ["--static", t.context.tmpDir, "--compress"],
    async (requestFile) => {
      let response;

      const gzipHeader = {
        "Accept-Encoding": "gzip",
      };

      const fileContents = "foo-contents";
      writeFileSync(join(t.context.tmpDir, "foo.html"), fileContents);
      writeFileSync(join(t.context.tmpDir, "foo.blah"), fileContents);

      /**
       * 1. Serves files uncompressed without gzip accept-encoding header
       */
      response = await requestFile("foo.html");
      t.is(response.status, 200);
      t.is(response.data, fileContents);
      t.falsy(getRawHeader(response, "Content-Encoding"));

      /**
       * 2. Serves compressible filetypes compressed with gzip accept-encoding header
       */
      response = await requestFile("foo.html", { headers: gzipHeader });
      t.is(response.status, 200);
      t.is(response.data, fileContents);
      t.is(getRawHeader(response, "Content-Encoding"), "gzip");

      /**
       * 3. Serves uncompressible filetypes uncompressed
       */
      response = await requestFile("foo.blah", { headers: gzipHeader });
      t.is(response.status, 200);
      t.is(response.data, fileContents);
      t.falsy(getRawHeader(response, "Content-Encoding"));

      /**
       * 4. Handles file not existing
       */
      response = await requestFile("does-not-exist.html", {
        headers: gzipHeader,
      });
      t.is(response.status, 404);
      t.regex(response.data, /no such file or directory/);
      t.falsy(getRawHeader(response, "Content-Encoding"));
    }
  );
});

test("With wait-for-lockfile", async (t) => {
  await withWsb(
    ["--static", t.context.tmpDir, "--wait-for-lockfile", 500],
    async (requestFile) => {
      /**
       * 1. Waits for lockfile to be removed
       */
      writeFileSync(join(t.context.tmpDir, "foo.html"), "foo-contents");
      writeFileSync(join(t.context.tmpDir, "foo.html.lock"), "foo-contents");

      let requestCompleted = false;
      let responseP = requestFile("foo.html").then((resp) => {
        requestCompleted = true;
        return resp;
      });

      await sleep(100);
      t.falsy(requestCompleted);
      writeFileSync(join(t.context.tmpDir, "foo.html"), "updated-foo-contents");

      await sleep(100);
      unlinkSync(join(t.context.tmpDir, "foo.html.lock"));

      let response = await responseP;
      t.is(response.status, 200);
      t.is(response.data, "updated-foo-contents");

      /**
       * 2. Times out if still locked after timeout period
       */
      writeFileSync(join(t.context.tmpDir, "foo.html"), "foo-contents");
      writeFileSync(join(t.context.tmpDir, "foo.html.lock"), "foo-contents");

      responseP = requestFile("foo.html");
      await sleep(600);
      response = await responseP;

      t.is(response.status, 200);
      t.regex(response.data, /timed out waiting for lock files to be removed/);
    }
  );
});

test("With wait-for-static", async (t) => {
  await withWsb(
    ["--static", t.context.tmpDir, "--wait-for-static", 500],
    async (requestFile) => {
      /**
       * 1. Waits for file to exist
       */
      let requestCompleted = false;
      let responseP = requestFile("bar.html").then((resp) => {
        requestCompleted = true;
        return resp;
      });

      await sleep(100);
      t.falsy(requestCompleted);

      writeFileSync(join(t.context.tmpDir, "bar.html"), "bar-contents");

      let response = await responseP;
      t.is(response.status, 200);
      t.is(response.data, "bar-contents");

      /**
       * 2. Times out if no file exists after the timeout period
       */
      responseP = requestFile("some-random-file.html");

      await sleep(600);

      response = await responseP;
      t.is(response.status, 200);
      t.regex(response.data, /timed out waiting for file to exist/);
    }
  );
});
