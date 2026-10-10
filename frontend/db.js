/* =========================================================
   GYMTRACK — Capa de datos (db.js)
   Simula las tablas del modelo relacional usando localStorage.
   Cada "tabla" es un arreglo guardado bajo una llave propia.
   ========================================================= */

const DB = {
  KEYS: {
    USUARIOS: 'gt_usuarios',
    SESION: 'gt_sesion',
    RUTINAS: 'gt_rutinas',
    ELEMENTOS: 'gt_elementos',
    PROGRESO: 'gt_progreso',
    METAS: 'gt_metas',
  },

  _get(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  },

  _set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  _uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /* ---------------- USUARIO ---------------- */

  getUsuarios() { return this._get(this.KEYS.USUARIOS, []); },

  registrarUsuario({ nombre, correo, contrasena }) {
    const usuarios = this.getUsuarios();
    if (usuarios.some(u => u.correo.toLowerCase() === correo.toLowerCase())) {
      return { ok: false, error: 'Ya existe una cuenta con ese correo.' };
    }
    const usuario = { id_usuario: this._uid('u'), nombre, correo, contrasena };
    usuarios.push(usuario);
    this._set(this.KEYS.USUARIOS, usuarios);
    this.iniciarSesion(correo, contrasena);
    return { ok: true, usuario };
  },

  iniciarSesion(correo, contrasena) {
    const usuario = this.getUsuarios().find(
      u => u.correo.toLowerCase() === correo.toLowerCase() && u.contrasena === contrasena
    );
    if (!usuario) return { ok: false, error: 'Correo o contraseña incorrectos.' };
    this._set(this.KEYS.SESION, { id_usuario: usuario.id_usuario });
    return { ok: true, usuario };
  },

  cerrarSesion() { localStorage.removeItem(this.KEYS.SESION); },

  usuarioActual() {
    const sesion = this._get(this.KEYS.SESION, null);
    if (!sesion) return null;
    return this.getUsuarios().find(u => u.id_usuario === sesion.id_usuario) || null;
  },

  actualizarPerfil(id_usuario, cambios) {
    const usuarios = this.getUsuarios().map(u => u.id_usuario === id_usuario ? { ...u, ...cambios } : u);
    this._set(this.KEYS.USUARIOS, usuarios);
  },

  /* ---------------- RUTINA (+ RUTINA_EJERCICIO embebido) ---------------- */

  getRutinas(id_usuario) {
    return this._get(this.KEYS.RUTINAS, []).filter(r => r.id_usuario === id_usuario);
  },

  crearRutina(id_usuario, { nombre, ejercicios }) {
    const rutinas = this._get(this.KEYS.RUTINAS, []);
    const rutina = {
      id_rutina: this._uid('r'),
      id_usuario,
      nombre,
      ejercicios: ejercicios || [], // [{nombre, series, repeticiones}]
      fecha_creacion: new Date().toISOString(),
      completada: false,
      duracion: null,
      fecha_realizada: null,
      elementos_practicados: [],
    };
    rutinas.push(rutina);
    this._set(this.KEYS.RUTINAS, rutinas);
    return rutina;
  },

  completarRutina(id_rutina, { duracion, elementos_practicados }) {
    const rutinas = this._get(this.KEYS.RUTINAS, []).map(r => {
      if (r.id_rutina !== id_rutina) return r;
      return {
        ...r,
        completada: true,
        duracion: Number(duracion) || 0,
        fecha_realizada: new Date().toISOString(),
        elementos_practicados: elementos_practicados || [],
      };
    });
    this._set(this.KEYS.RUTINAS, rutinas);
  },

  eliminarRutina(id_rutina) {
    const rutinas = this._get(this.KEYS.RUTINAS, []).filter(r => r.id_rutina !== id_rutina);
    this._set(this.KEYS.RUTINAS, rutinas);
  },

  /* ---------------- ELEMENTO (catálogo + semilla) ---------------- */

  SEED_ELEMENTOS: [
    { nombre: 'Rueda lateral', categoria: 'Suelo', nivel: 'Básico', descripcion: 'Giro lateral apoyando manos y pies en línea recta.', requisitos: 'Ninguno' },
    { nombre: 'Vertical (parada de manos)', categoria: 'Equilibrio', nivel: 'Intermedio', descripcion: 'Sostener el cuerpo en línea recta apoyado sobre las manos.', requisitos: 'Fuerza de hombro y core' },
    { nombre: 'Puente', categoria: 'Flexibilidad', nivel: 'Básico', descripcion: 'Arco de espalda apoyando manos y pies en el suelo.', requisitos: 'Ninguno' },
    { nombre: 'Split (spagat)', categoria: 'Flexibilidad', nivel: 'Básico', descripcion: 'Apertura completa de piernas en el eje frontal.', requisitos: 'Elongación previa' },
    { nombre: 'Salto carpado', categoria: 'Saltos', nivel: 'Intermedio', descripcion: 'Salto con flexión de cadera y piernas extendidas al frente.', requisitos: 'Salto básico' },
    { nombre: 'Mortal adelante', categoria: 'Saltos', nivel: 'Avanzado', descripcion: 'Giro completo del cuerpo hacia adelante en el aire.', requisitos: 'Rondada y flic flac' },
    { nombre: 'Giro de 360°', categoria: 'Giros', nivel: 'Intermedio', descripcion: 'Rotación completa del cuerpo sobre un eje vertical.', requisitos: 'Equilibrio en un pie' },
    { nombre: 'Rondada', categoria: 'Suelo', nivel: 'Intermedio', descripcion: 'Enlace que transforma el impulso lineal en rotación hacia atrás.', requisitos: 'Rueda lateral' },
    { nombre: 'Flic flac', categoria: 'Elementos aéreos', nivel: 'Avanzado', descripcion: 'Salto hacia atrás apoyando las manos en el suelo.', requisitos: 'Rondada, fuerza de brazos' },
    { nombre: 'Plancha (frontal)', categoria: 'Flexibilidad', nivel: 'Básico', descripcion: 'Elevar una pierna en línea con el torso sujeto de un apoyo.', requisitos: 'Ninguno' },
  ],

  getElementos() {
    let elementos = this._get(this.KEYS.ELEMENTOS, null);
    if (!elementos) {
      elementos = this.SEED_ELEMENTOS.map(e => ({ id_elemento: this._uid('e'), ...e }));
      this._set(this.KEYS.ELEMENTOS, elementos);
    }
    return elementos;
  },

  /* ---------------- PROGRESO (usuario x elemento) ---------------- */

  getProgreso(id_usuario) { return this._get(this.KEYS.PROGRESO, []).filter(p => p.id_usuario === id_usuario); },

  getProgresoElemento(id_usuario, id_elemento) {
    return this.getProgreso(id_usuario).find(p => p.id_elemento === id_elemento) || null;
  },

  actualizarProgreso(id_usuario, id_elemento, { estado, porcentaje }) {
    const todos = this._get(this.KEYS.PROGRESO, []);
    const idx = todos.findIndex(p => p.id_usuario === id_usuario && p.id_elemento === id_elemento);
    if (idx >= 0) {
      todos[idx] = { ...todos[idx], estado, porcentaje };
    } else {
      todos.push({ id_progreso: this._uid('p'), id_usuario, id_elemento, estado, porcentaje });
    }
    this._set(this.KEYS.PROGRESO, todos);
  },

  /* ---------------- META ---------------- */

  getMetas(id_usuario) { return this._get(this.KEYS.METAS, []).filter(m => m.id_usuario === id_usuario); },

  crearMeta(id_usuario, { descripcion, fecha }) {
    const metas = this._get(this.KEYS.METAS, []);
    const meta = { id_meta: this._uid('m'), id_usuario, descripcion, fecha, progreso: 0 };
    metas.push(meta);
    this._set(this.KEYS.METAS, metas);
    return meta;
  },

  actualizarMeta(id_meta, progreso) {
    const metas = this._get(this.KEYS.METAS, []).map(m => m.id_meta === id_meta ? { ...m, progreso: Number(progreso) } : m);
    this._set(this.KEYS.METAS, metas);
  },

  eliminarMeta(id_meta) {
    const metas = this._get(this.KEYS.METAS, []).filter(m => m.id_meta !== id_meta);
    this._set(this.KEYS.METAS, metas);
  },

  /* ---------------- ESTADÍSTICAS derivadas ---------------- */

  getEstadisticas(id_usuario) {
    const rutinas = this.getRutinas(id_usuario).filter(r => r.completada);
    const progreso = this.getProgreso(id_usuario);

    const entrenamientosRealizados = rutinas.length;
    const tiempoTotalMin = rutinas.reduce((acc, r) => acc + (r.duracion || 0), 0);
    const elementosDominados = progreso.filter(p => p.estado === 'Dominado').length;

    // Progreso mensual: entrenamientos por mes (últimos 6 meses)
    const meses = [];
    const ahora = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      meses.push({ etiqueta: d.toLocaleDateString('es-ES', { month: 'short' }), year: d.getFullYear(), month: d.getMonth(), total: 0 });
    }
    rutinas.forEach(r => {
      const f = new Date(r.fecha_realizada);
      const m = meses.find(m => m.year === f.getFullYear() && m.month === f.getMonth());
      if (m) m.total += 1;
    });

    // Racha de entrenamiento: días consecutivos con al menos una rutina completada
    const dias = [...new Set(rutinas.map(r => r.fecha_realizada.slice(0, 10)))].sort().reverse();
    let racha = 0;
    let cursor = new Date();
    for (let d of dias) {
      const fechaStr = cursor.toISOString().slice(0, 10);
      if (d === fechaStr) {
        racha++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    return { entrenamientosRealizados, tiempoTotalMin, elementosDominados, meses, racha };
  },
};
