registerQuiz("13-tcp", [
  {
    q: "What type of object does the connection callback in 'net.createServer' receive?",
    options: [
      "A Buffer containing the first chunk of data",
      "A net.Socket, which is a full Duplex stream",
      "An http.IncomingMessage object",
      "A plain object with 'read' and 'write' methods"
    ],
    answer: 1,
    explain: "The connection callback in 'net.createServer' receives a 'net.Socket', which implements the Duplex stream interface. You can pipe it, use readline on it, or attach standard stream events like 'data', 'end', and 'error'."
  },
  {
    q: "If a TCP client calls 'socket.write(\"hello\")' followed immediately by 'socket.write(\" world\")', what will the server most likely receive?",
    options: [
      "Exactly two separate 'data' events: one with 'hello' and one with ' world'",
      "One or more 'data' events containing some combination of the bytes, as the OS decides",
      "A single 'data' event always containing 'hello world' due to Nagle's algorithm",
      "An error, because you cannot call write twice in a row"
    ],
    answer: 1,
    explain: "TCP is a byte stream — there are no message boundaries. The OS may merge multiple writes into one packet via Nagle's algorithm, or split a write across multiple packets. The server may receive the bytes in any chunking arrangement."
  },
  {
    q: "Which socket event fires when the remote side has finished sending data (sent a TCP FIN packet) but the local side may still send data?",
    options: [
      "close",
      "finish",
      "end",
      "drain"
    ],
    answer: 2,
    explain: "The 'end' event fires when the remote side sends a TCP FIN, signaling it is done writing (a half-close). The connection is not fully closed yet; the local side can still send data until it also calls 'socket.end()' to send its own FIN."
  }
]);

registerResources("13-tcp", [
  { title: "Node.js docs: net module", url: "https://nodejs.org/api/net.html" },
  { title: "Node.js docs: net.Socket", url: "https://nodejs.org/api/net.html#class-netsocket" },
  { title: "Node.js docs: net.createServer", url: "https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener" },
  { title: "RFC 9293: Transmission Control Protocol", url: "https://www.rfc-editor.org/rfc/rfc9293" },
  { title: "Node.js docs: stream.Duplex", url: "https://nodejs.org/api/stream.html#class-streamduplex" }
]);

registerQuiz("13-udp-dns", [
  {
    q: "Unlike TCP, UDP guarantees that each 'socket.send()' call produces exactly one datagram received as one 'message' event. What does UDP NOT guarantee?",
    options: [
      "That the datagram has message boundaries",
      "That the payload is a Buffer",
      "That datagrams are delivered or arrive in the order they were sent",
      "That the sender and receiver agree on a port number"
    ],
    answer: 2,
    explain: "UDP provides message boundaries (one send = one 'message' event), but it does NOT guarantee delivery or ordering. Datagrams can be lost or arrive out of order, which is why protocols like video streaming tolerate dropped packets."
  },
  {
    q: "What is the critical difference between 'dns.lookup' and 'dns.resolve4' in Node.js?",
    options: [
      "'dns.lookup' returns IPv6 addresses while 'dns.resolve4' returns IPv4 addresses",
      "'dns.lookup' uses the OS resolver and libuv thread pool; 'dns.resolve4' speaks DNS directly on the event loop",
      "'dns.lookup' is synchronous; 'dns.resolve4' is asynchronous",
      "'dns.resolve4' respects '/etc/hosts' while 'dns.lookup' does not"
    ],
    answer: 1,
    explain: "'dns.lookup' calls the OS 'getaddrinfo' function (runs in the libuv thread pool, respects /etc/hosts and VPN routing). 'dns.resolve4' speaks the DNS wire protocol directly on the event loop, bypassing the OS resolver and ignoring local overrides."
  },
  {
    q: "What is the maximum payload size for a single UDP datagram over IPv4?",
    options: [
      "1,500 bytes (the typical Ethernet MTU)",
      "8,192 bytes",
      "65,507 bytes",
      "Unlimited — the OS fragments large payloads automatically"
    ],
    answer: 2,
    explain: "A single UDP datagram's payload is limited to 65,507 bytes over IPv4 (65,535 bytes minus the 20-byte IP header and 8-byte UDP header). Staying well under the MTU (~1,500 bytes) avoids IP fragmentation."
  }
]);

registerResources("13-udp-dns", [
  { title: "Node.js docs: dgram module", url: "https://nodejs.org/api/dgram.html" },
  { title: "Node.js docs: dns module", url: "https://nodejs.org/api/dns.html" },
  { title: "Node.js docs: dns.lookup", url: "https://nodejs.org/api/dns.html#dnslookuphostname-options-callback" },
  { title: "Node.js docs: dns/promises", url: "https://nodejs.org/api/dns.html#dnspromisesapi" },
  { title: "RFC 768: User Datagram Protocol", url: "https://www.rfc-editor.org/rfc/rfc768" }
]);

registerQuiz("13-framing", [
  {
    q: "In length-prefix framing, what does the sender write before the payload?",
    options: [
      "A newline character to delimit the message",
      "A fixed-width header containing the byte length of the payload",
      "A JSON wrapper with a 'length' field",
      "The destination port number as a 4-byte integer"
    ],
    answer: 1,
    explain: "Length-prefix framing encodes the payload size in a fixed-width header (commonly 4 bytes / UInt32) placed before the payload bytes. The receiver reads the header first, extracts the length, then reads exactly that many bytes."
  },
  {
    q: "Why does delimiter framing break when the payload itself contains the delimiter character?",
    options: [
      "The delimiter character is reserved by TCP and cannot appear in payloads",
      "The receiver cannot distinguish a delimiter inside the payload from the actual message boundary",
      "Node's readline module strips the delimiter from all data before emitting it",
      "HTTP does not allow control characters in bodies"
    ],
    answer: 1,
    explain: "With delimiter framing, the receiver scans for the sentinel byte (e.g., '\\n') to find message boundaries. If the payload also contains that byte, the receiver incorrectly splits the message mid-payload. Binary data must be base64-encoded or length-prefix framing used instead."
  },
  {
    q: "Which Node.js built-in module is commonly used to implement delimiter framing over a TCP socket by automatically splitting a Readable stream on newlines?",
    options: [
      "node:stream",
      "node:buffer",
      "node:readline",
      "node:net"
    ],
    answer: 2,
    explain: "'node:readline' provides 'readline.createInterface({ input: socket })' which emits a 'line' event for each complete newline-terminated message. It handles partial chunks internally, which is exactly the accumulator logic needed for delimiter framing."
  }
]);

registerResources("13-framing", [
  { title: "Node.js docs: readline module", url: "https://nodejs.org/api/readline.html" },
  { title: "Node.js docs: net module", url: "https://nodejs.org/api/net.html" },
  { title: "Node.js docs: Buffer", url: "https://nodejs.org/api/buffer.html" },
  { title: "Redis RESP3 protocol specification", url: "https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md" },
  { title: "RFC 4506: XDR: External Data Representation Standard", url: "https://www.rfc-editor.org/rfc/rfc4506" }
]);
