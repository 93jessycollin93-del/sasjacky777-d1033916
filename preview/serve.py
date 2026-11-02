import http.server, functools, os
d = os.path.dirname(os.path.abspath(__file__))
http.server.ThreadingHTTPServer(("0.0.0.0", 8080), functools.partial(http.server.SimpleHTTPRequestHandler, directory=d)).serve_forever()
