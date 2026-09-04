import readline from "node:readline";

export class RpcClient {
  #child;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();
  #stderr = "";

  constructor(child) {
    this.#child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (this.#stderr += chunk));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
    child.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited code=${code} signal=${signal}: ${this.#stderr}`);
      this.#rejectPending(error);
    });
  }

  request(method, params) {
    const id = this.#nextId++;
    this.#send({ method, id, params });
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  notify(method, params) {
    this.#send({ method, params });
  }

  onNotification(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() {
    this.#child.stdin.end();
    if (!this.#child.killed) this.#child.kill("SIGTERM");
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const bytes = Buffer.from(line, "utf8");
      const prefixByte = bytes.subarray(0, 1).toString("hex") || "empty";
      this.#rejectPending(new Error(`invalid app-server JSON length=${bytes.length} prefixByte=${prefixByte}`));
      return;
    }
    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`RPC ${message.id}: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#send({ id: message.id, error: { code: -32601, message: `unexpected server request: ${message.method}` } });
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  #rejectPending(error) {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}
