# wsb

wsb is a simple server for broadcasting websocket messages quickly.

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
Usage: wbr [options]

Options:
  --help, -h         Show help                                            [boolean]
  --version, -V, -v  Show version number                                  [boolean]
  --verbose          Add some logging about what the server is doing      [boolean]
  --port, -p         Start the server running on this port (default 8080)  [number]
  --static           Serve static files from this directory                [string]
  --wait-for-static  If the file can't be found, keep trying until this    [number]
                   amount of ms has passed.
```
