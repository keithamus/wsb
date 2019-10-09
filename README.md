# wsb

wsb is a simple server for broadcasting websocket messages quickly. In addition
it has a couple of nifty static file serving tools, which makes it really
useful for a lightweight livereload server.

```
$ npx wsb --port 3000
wsb listening on 3000

# Connect to the websocket on 3000, then...

$ curl 'localhost:3342/b?foo=bar'
# All clients received:
{
  "foo": "bar"
}
```

## Usage

```
Usage: wsb [options]

Options:
  --help, -h          Show help                                            [boolean]
  --version, -V, -v   Show version number                                  [boolean]
  --verbose           Add some logging about what the server is doing      [boolean]
  --port, -p          Start the server running on this port (default 8080)  [number]
  --static            Serve static files from this directory                [string]
  --pauseable-static  Make a static server that can be paused via the API   [string]
  --wait-for-static   If the file can't be found, keep trying until this    [number]
                      amount of ms has passed.
  --wait-for-lockfile Will hang any requests when a `*.lock` file is        [number]
                      present, until a number of ms has passed. `.ext.lock`
                      files can be used to prevent specific files, e.g.
                      `foo.css.lock` will only hang on `*.css` files.
```


## Static Server

If you pass `--static path/to/static` to the command it will run a simple
static server, serving up any files in that directory. This can be very handy
to serve up - for example - an index.html that bootstraps a websocket so that
you can use it as a listener for the broadcast events.

## Useful extras

### wait-for-static

This allows you to request a file before it exists, and the server will hold
the response until either the timeout has passed, or the file exists. This is
a handy feature for running a server where assets might get deleted and
rebuilt, and rather than just erroring with a 404, the server can have a small
grace period for serving up files.

So if you pass `--wait-for-static N` (where `N` is the number of milliseconds)
then the server will ignore any `ENOENT` (file not found) errors for up to `N`
milliseconds. It will keep retrying the file every 100ms until `N` has passed before returning a 404.
For example:

```
# Run the server in the background
$ wsb -p 8080 --static . --wait-for-static 6000 &

# Try curling for a file that doesn't exist:
$ curl localhost:8080/index.html
# ^ this request will hang until 6 seconds has passed before 404ing

# if you wait for it to timeout:
Error: timeout
    at Timeout.tryFile [as _onTimeout] (index.js:154:57)
    at listOnTimeout (timers.js:324:15)
    at processTimers (timers.js:268:5)

# however if you create the file within the 6 minute window:
Ctrl+Z

$ echo 'hello world!' > index.html

Response from Job 2 (curl):
hello world!
```

### pausable-static

This feature exposes an API to pause/unpause the static file server. Any
requests to the static file server made while the server is paused will hang
until it is unpaused. Similar to `--wait-for-static` - this feature is very
handy for asset compilers - where you can make a request to pause the static
server while compiling, and unpause it after - thereby making requests hang
until the compiler has finished compiling!

So if you pass `--pausable-static path/to/static` (replacing the `--static` argument)
then the server will expose a `/pause` and a `/unpause` endpoint:

```
# Run the server in the background
$ wsb -p 8080 --static . --wait-for-static 6000 &

# Curling a file that exists:
$ curl localhost:8080/index.html
hello world

# Pause the server:
$ curl localhost:8080/pause
pausing static server

# Try curling again: notice the response just hangs
$ curl localhost:8080/index.html
Ctrl+Z

# Unpause the server:
$ curl localhost:8080/unpause
pausing static server

Response from Job 2 (curl)
hello world!
```

### wait-for-lockfile

Switching this feature on will make the server hang if there are any `.lock`
files inside the static directory.

So if you pass `--static path/to/static --wait-for-lockfile 10000`, then assets
will be served from `path/to/static` as normal, _unless_ a file like
`path/to/static/*.lock` exists. If that file exists, the server will hang until
that file is removed. This is useful for having compilers touch a `.lock` file
at the beginning of their compile, and removing it after they're done.

In addition to this, lockfiles with two extensions will lock _only extensions
that match_. For example a `foo.css.lock` file will only prevent `.css` files
from being immediately served, so for example files with a `.js` extension will
still be served.

Here's an example:

```
# Run the server in the background
$ wsb -p 8080 --static . --wait-for-lockfile 6000 &

$ echo 'hello world!' > index.html

# Try curling for a file that exists:
$ curl localhost:8080/index.html
hello world!


# Now add a lockfile and watch it hang:

$ touch compiler.lock

$ curl localhost:8080/index.html

Ctrl+z

# Now if you remove the lockfile any requests will finally complete:
$ rm compiler.lock

Response from Job 2 (curl):
hello world!

# Try a `compiler.css.lock` file and see it has no effect on html files:

$ echo 'I am CSS!' > index.css
$ touch compiler.css.lock
$ curl localhost:8080/index.html
hello world!

# But css files it does:
$ curl localhost:8080/index.css

Ctrl+z

$ rm compiler.css.lock

Response from Job 2 (curl):
hello world!
```
