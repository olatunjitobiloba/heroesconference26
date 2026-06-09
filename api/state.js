const rooms = globalThis.__heroesConferenceRooms || new Map();
globalThis.__heroesConferenceRooms = rooms;

function defaultState() {
  return {
    min: 1,
    max: 1000,
    drawCount: 1,
    unique: true,
    winners: [],
    current: null,
    drawing: false,
    drawingUntil: 0,
    target: null,
    version: Date.now(),
    message: "Live draw ready"
  };
}

function roomKey(value) {
  return String(value || "adullam-main").replace(/[^a-z0-9-]/gi, "").slice(0, 48) || "adullam-main";
}

function getRoom(name) {
  const key = roomKey(name);
  if (!rooms.has(key)) rooms.set(key, defaultState());
  return rooms.get(key);
}

function nextVersion(state) {
  return Math.max(Date.now(), Number(state.version) || 0, Number(state.drawingUntil) || 0) + 1;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
}

function adminToken() {
  return process.env.ADMIN_TOKEN || "";
}

function adminPin() {
  return process.env.ADMIN_PIN || "";
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  return adminToken() && header === `Bearer ${adminToken()}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function availableNumbers(state) {
  const used = new Set(state.winners.map((winner) => winner.number));
  const numbers = [];
  for (let number = state.min; number <= state.max; number += 1) {
    if (!state.unique || !used.has(number)) numbers.push(number);
  }
  return numbers;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWinner(pool) {
  return pool[randomInt(0, pool.length - 1)];
}

function publicState(state) {
  const now = Date.now();
  if (state.drawing && state.drawingUntil && now >= state.drawingUntil) {
    state.drawing = false;
    state.message = "Winner locked";
    state.version = Math.max(state.version, state.drawingUntil);
  }

  return {
    min: state.min,
    max: state.max,
    drawCount: state.drawCount,
    unique: state.unique,
    winners: state.winners,
    current: state.current,
    drawing: state.drawing,
    drawingUntil: state.drawingUntil,
    target: state.target,
    version: state.version,
    message: state.message
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const action = url.searchParams.get("action") || "state";

  if (req.method === "GET") {
    return json(res, 200, publicState(getRoom(url.searchParams.get("room"))));
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  if (action === "login") {
    if (!adminPin() || !adminToken()) {
      return json(res, 500, { error: "Admin credentials are not configured" });
    }
    if (String(body.pin || "") !== adminPin()) {
      return json(res, 401, { error: "Invalid PIN" });
    }
    return json(res, 200, { token: adminToken() });
  }

  if (!isAuthorized(req)) {
    return json(res, 401, { error: "Admin login required" });
  }

  const state = getRoom(body.room);

  if (action === "settings") {
    state.min = clamp(body.min, 1, 1000);
    state.max = clamp(body.max, 1, 1000);
    if (state.min > state.max) [state.min, state.max] = [state.max, state.min];
    state.drawCount = clamp(body.drawCount, 1, 50);
    state.unique = Boolean(body.unique);
    state.version = nextVersion(state);
    state.message = "Settings updated";
    return json(res, 200, publicState(state));
  }

  if (action === "reset") {
    const version = nextVersion(state);
    const next = defaultState();
    next.min = clamp(body.min, 1, 1000);
    next.max = clamp(body.max, 1, 1000);
    next.version = version;
    rooms.set(roomKey(body.room), next);
    next.message = "Live draw reset";
    return json(res, 200, publicState(next));
  }

  if (action === "draw") {
    state.min = clamp(body.min, 1, 1000);
    state.max = clamp(body.max, 1, 1000);
    if (state.min > state.max) [state.min, state.max] = [state.max, state.min];
    state.drawCount = clamp(body.drawCount, 1, 50);
    state.unique = Boolean(body.unique);

    const pool = availableNumbers(state);
    if (!pool.length) {
      state.message = "All numbers have been drawn";
      state.version = nextVersion(state);
      return json(res, 409, { error: state.message, ...publicState(state) });
    }

    const version = nextVersion(state);
    const winner = pickWinner(pool);
    state.current = winner;
    state.target = winner;
    state.drawing = true;
    state.drawingUntil = version + 4600;
    state.winners.unshift({ number: winner, time: new Date().toISOString() });
    state.version = version;
    state.message = "Drawing winner";

    return json(res, 200, publicState(state));
  }

  return json(res, 404, { error: "Unknown action" });
}
