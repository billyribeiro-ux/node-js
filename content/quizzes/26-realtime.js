registerQuiz("26-websockets", [
  {
    q: "What HTTP status code does the server send to complete the WebSocket upgrade handshake?",
    options: [
      "200 OK",
      "101 Switching Protocols",
      "301 Moved Permanently",
      "426 Upgrade Required"
    ],
    answer: 1,
    explain: "The server responds with '101 Switching Protocols' to signal that the TCP connection is being handed over to the WebSocket framing layer. After this single round-trip, HTTP is no longer used and both sides communicate via WebSocket frames."
  },
  {
    q: "Why must a broadcast loop guard each send with 'client.readyState === WebSocket.OPEN'?",
    options: [
      "OPEN is the only state that supports binary messages",
      "Calling send() on a socket in CLOSING or CLOSED state throws an error",
      "The guard prevents the same message from being sent twice",
      "WebSocket.OPEN is required to enable the ping/pong heartbeat"
    ],
    answer: 1,
    explain: "A client in wss.clients can be in CONNECTING, OPEN, CLOSING, or CLOSED state. Calling send() on a non-OPEN socket throws a synchronous error. The guard ensures only truly open connections receive messages, avoiding crashes during connection teardown."
  },
  {
    q: "What is the purpose of the ping/pong heartbeat in a WebSocket server?",
    options: [
      "To compress messages and reduce bandwidth",
      "To detect silently dropped TCP connections that NAT or load balancers have removed",
      "To synchronise clocks between server and client",
      "To negotiate message encoding between server and client"
    ],
    answer: 1,
    explain: "TCP connections can be silently discarded by NAT devices, firewalls, or load balancers without either end noticing. The server periodically sends a Ping frame; clients must reply with Pong. Sockets that fail to pong within the timeout are terminated and removed from the active set."
  }
]);

registerResources("26-websockets", [
  { title: "WebSocket protocol (RFC 6455)", url: "https://datatracker.ietf.org/doc/html/rfc6455" },
  { title: "ws library documentation", url: "https://github.com/websockets/ws/blob/master/README.md" },
  { title: "WebSocket API (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/API/WebSocket" },
  { title: "Node.js WebSocket client (native, Node 22+)", url: "https://nodejs.org/api/globals.html#websocket" },
  { title: "ws API reference", url: "https://github.com/websockets/ws/blob/master/doc/ws.md" }
]);

registerQuiz("26-socketio", [
  {
    q: "What is the key difference between 'socket.to(room).emit()' and 'io.to(room).emit()' in Socket.IO?",
    options: [
      "socket.to() sends binary data; io.to() sends text only",
      "socket.to(room) excludes the sending socket; io.to(room) includes the sender in the broadcast",
      "io.to() is asynchronous; socket.to() is synchronous",
      "socket.to() requires an acknowledgement callback; io.to() does not"
    ],
    answer: 1,
    explain: "socket.to(room) broadcasts to all other members of the room, excluding the socket that called it. io.to(room) broadcasts to all members including the originating socket. The distinction matters for chat messages (usually exclude sender) versus system announcements (include everyone)."
  },
  {
    q: "Why must Socket.IO DataLoader instances (and presence Maps) be cleaned up in the 'disconnect' handler?",
    options: [
      "Socket.IO automatically removes all application-level state when a socket disconnects",
      "Socket.IO removes the socket from rooms automatically, but any application-level Maps or Sets your code maintains are not touched",
      "The 'disconnect' event only fires if the client explicitly called socket.disconnect()",
      "Failing to clean up prevents the socket from being garbage collected but has no functional impact"
    ],
    answer: 1,
    explain: "Socket.IO removes a disconnected socket from its rooms automatically, but your own application-level state (presence Maps, typing Sets, user lookup tables) is not touched. Without a 'disconnect' cleanup, those Maps grow indefinitely and can leak stale user references."
  },
  {
    q: "Socket.IO namespaces allow you to:",
    options: [
      "Run multiple WebSocket servers on different ports from one process",
      "Create virtual endpoint paths (like /chat and /admin) that share one HTTP server but have separate connection handlers and middleware",
      "Restrict which rooms a socket can join",
      "Enable binary message support for specific clients"
    ],
    answer: 1,
    explain: "Namespaces (io.of('/chat'), io.of('/admin')) are virtual divisions of the same Socket.IO server sharing the same HTTP port. Each namespace has independent connection lifecycle, middleware chains, and event handlers, allowing clean separation of concerns without running multiple servers."
  }
]);

registerResources("26-socketio", [
  { title: "Socket.IO documentation", url: "https://socket.io/docs/v4/" },
  { title: "Socket.IO rooms", url: "https://socket.io/docs/v4/rooms/" },
  { title: "Socket.IO namespaces", url: "https://socket.io/docs/v4/namespaces/" },
  { title: "Socket.IO acknowledgements", url: "https://socket.io/docs/v4/emitting-events/#acknowledgements" },
  { title: "Socket.IO emit cheatsheet", url: "https://socket.io/docs/v4/emit-cheatsheet/" }
]);

registerQuiz("26-scaling-realtime", [
  {
    q: "Why do room broadcasts silently fail when two Socket.IO instances sit behind a round-robin load balancer without the Redis adapter?",
    options: [
      "Round-robin load balancers block WebSocket connections",
      "Each instance maintains its own in-memory room map, so a broadcast on instance A has no knowledge of clients connected to instance B",
      "The Redis adapter is required to parse WebSocket frames correctly",
      "Socket.IO uses process.send() to forward events, which is unavailable across machines"
    ],
    answer: 1,
    explain: "Room membership is tracked per-process in memory. Instance A's io.to('general') only reaches clients whose sockets are held by A. Instance B's clients are invisible to A. The Redis adapter fixes this by publishing broadcasts to a shared Redis pub/sub channel that all instances subscribe to."
  },
  {
    q: "Why does the @socket.io/redis-adapter require two separate Redis client connections?",
    options: [
      "One connection handles reads; the other handles writes for performance reasons",
      "Redis does not allow a connection in pub/sub subscriber mode to issue regular commands, so a separate client is needed for publishing and general use",
      "The two clients implement automatic failover in case one Redis connection drops",
      "Socket.IO uses one client per namespace"
    ],
    answer: 1,
    explain: "Once a Redis client enters SUBSCRIBE mode it can only issue subscribe/unsubscribe/ping commands. The pub/sub adapter needs to both subscribe to incoming cross-node events and publish outgoing ones, which requires two distinct clients: one locked in subscriber mode and one for publishing."
  },
  {
    q: "What is the purpose of sticky sessions (session affinity) in a horizontally-scaled Socket.IO deployment?",
    options: [
      "Sticky sessions cache the Socket.IO handshake to reduce CPU load",
      "They ensure all WebSocket frames from a given client are routed to the same upstream server instance, because WebSocket is a persistent connection",
      "Sticky sessions enable the Redis adapter to batch messages for the same client",
      "They allow multiple clients to share a single WebSocket connection"
    ],
    answer: 1,
    explain: "A WebSocket connection is a persistent TCP stream. If the load balancer routes different frames from the same client to different instances, the connection breaks immediately. Sticky sessions (IP hash or cookie affinity) keep all frames for a client on the same upstream, while the Redis adapter handles cross-instance event fanout."
  }
]);

registerResources("26-scaling-realtime", [
  { title: "Socket.IO Redis adapter documentation", url: "https://socket.io/docs/v4/redis-adapter/" },
  { title: "@socket.io/redis-adapter on npm", url: "https://github.com/socketio/socket.io-redis-adapter" },
  { title: "Socket.IO using multiple nodes", url: "https://socket.io/docs/v4/using-multiple-nodes/" },
  { title: "Redis pub/sub documentation", url: "https://redis.io/docs/latest/develop/interact/pubsub/" },
  { title: "Server-Sent Events (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events" }
]);
