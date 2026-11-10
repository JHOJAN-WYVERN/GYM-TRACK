const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { createServer: createHttpServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const COOKIE_NAME = 'gymtrack_session';

function publicUser(user) {
  return {
    id_usuario: user.id_usuario,
    nombre: user.nombre,
    correo: user.correo,
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return ['', ''];
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }).filter(([name]) => name)
  );
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!request.headers['content-type']?.includes('application/json')) {
    const error = new Error('El contenido debe ser JSON.');
    error.statusCode = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('La solicitud es demasiado grande.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('El JSON de la solicitud no es válido.');
    error.statusCode = 400;
    throw error;
  }
}

function validateCredentials({ nombre, correo, contrasena }, registering) {
  if (registering && (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 100)) {
    return 'Escribe un nombre de hasta 100 caracteres.';
  }
  if (typeof correo !== 'string' || correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return 'Escribe un correo válido.';
  }
  if (typeof contrasena !== 'string' || contrasena.length < 8 || contrasena.length > 128) {
    return 'La contraseña debe tener entre 8 y 128 caracteres.';
  }
  return null;
}

function createServer({
  dbPath = path.join(__dirname, 'data', 'gymtrack.sqlite'),
  frontendDir = path.join(__dirname, 'frontend'),
} = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id_usuario TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id_usuario) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

  const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sessionCookie = (token) =>
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie}`;
  const clearCookie = () =>
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`;

  function getUserForRequest(request) {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    return database.prepare(`
      SELECT users.id_usuario, users.nombre, users.correo, sessions.token_hash
      FROM sessions JOIN users ON users.id_usuario = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), Date.now()) || null;
  }

  function createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    return token;
  }

  const server = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const route = `${request.method} ${url.pathname}`;

      if (route === 'POST /api/register') {
        const body = await readJson(request);
        const validationError = validateCredentials(body, true);
        if (validationError) return sendJson(response, 400, { error: validationError });

        const salt = randomBytes(16).toString('hex');
        const passwordHash = await scryptAsync(body.contrasena, salt, 64);
        const user = {
          id_usuario: `u_${randomBytes(12).toString('hex')}`,
          nombre: body.nombre.trim(),
          correo: body.correo.trim().toLowerCase(),
          password_salt: salt,
          password_hash: passwordHash.toString('hex'),
          created_at: new Date().toISOString(),
        };

        try {
          database.prepare(`
            INSERT INTO users (id_usuario, nombre, correo, password_salt, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(user.id_usuario, user.nombre, user.correo, user.password_salt, user.password_hash, user.created_at);
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed: users.correo')) {
            return sendJson(response, 409, { error: 'Ya existe una cuenta con ese correo.' });
          }
          throw error;
        }

        const token = createSession(user.id_usuario);
        return sendJson(response, 201, { usuario: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
      }

      if (route === 'POST /api/login') {
        const body = await readJson(request);
        const validationError = validateCredentials(body, false);
        if (validationError) return sendJson(response, 400, { error: validationError });

        const user = database.prepare('SELECT * FROM users WHERE correo = ? COLLATE NOCASE')
          .get(body.correo.trim().toLowerCase());
        if (!user) return sendJson(response, 401, { error: 'Correo o contraseña incorrectos.' });

        const candidate = await scryptAsync(body.contrasena, user.password_salt, 64);
        const storedHash = Buffer.from(user.password_hash, 'hex');
        if (!timingSafeEqual(candidate, storedHash)) {
          return sendJson(response, 401, { error: 'Correo o contraseña incorrectos.' });
        }

        const token = createSession(user.id_usuario);
        return sendJson(response, 200, { usuario: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
      }

      if (route === 'GET /api/me') {
        const user = getUserForRequest(request);
        if (!user) return sendJson(response, 401, { error: 'Inicia sesión para continuar.' });
        return sendJson(response, 200, { usuario: publicUser(user) });
      }

      if (route === 'PATCH /api/me') {
        const user = getUserForRequest(request);
        if (!user) return sendJson(response, 401, { error: 'Inicia sesión para continuar.' });
        const body = await readJson(request);
        if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.trim().length > 100) {
          return sendJson(response, 400, { error: 'Escribe un nombre de hasta 100 caracteres.' });
        }
        database.prepare('UPDATE users SET nombre = ? WHERE id_usuario = ?')
          .run(body.nombre.trim(), user.id_usuario);
        const updatedUser = database.prepare('SELECT id_usuario, nombre, correo FROM users WHERE id_usuario = ?')
          .get(user.id_usuario);
        return sendJson(response, 200, { usuario: publicUser(updatedUser) });
      }

      if (route === 'POST /api/logout') {
        const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
        if (token) {
          database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
        }
        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
      }

      if (url.pathname.startsWith('/api/')) {
        return sendJson(response, 404, { error: 'Ruta no encontrada.' });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { error: 'Método no permitido.' }, { Allow: 'GET, HEAD' });
      }

      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = path.resolve(frontendDir, `.${pathname}`);
      const relativePath = path.relative(frontendDir, filePath);
      if (relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
        return sendJson(response, 403, { error: 'Acceso denegado.' });
      }

      let file;
      try {
        file = fs.readFileSync(filePath);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
          return sendJson(response, 404, { error: 'Archivo no encontrado.' });
        }
        throw error;
      }

      const contentTypes = {
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
      });
      response.end(request.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error.statusCode) return sendJson(response, error.statusCode, { error: error.message });
      console.error('Error al procesar la solicitud:', error);
      return sendJson(response, 500, { error: 'Ocurrió un error interno. Inténtalo de nuevo.' });
    }
  });

  server.on('close', () => database.close());
  server.database = database;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`GymTrack disponible en http://${host}:${port}`);
  });
}

module.exports = { createServer };
