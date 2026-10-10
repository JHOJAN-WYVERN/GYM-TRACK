/* =========================================================
   GYMTRACK — Navegación compartida (nav.js)
   ========================================================= */

const NAV_LINKS = [
  { href: 'dashboard.html', label: 'Dashboard' },
  { href: 'rutinas.html', label: 'Rutinas' },
  { href: 'elementos.html', label: 'Elementos' },
  { href: 'metas.html', label: 'Metas' },
  { href: 'historial.html', label: 'Historial' },
  { href: 'estadisticas.html', label: 'Estadísticas' },
  { href: 'perfil.html', label: 'Perfil' },
];

function requireAuth() {
  const usuario = DB.usuarioActual();
  if (!usuario) {
    window.location.href = 'index.html';
    return null;
  }
  return usuario;
}

function renderSidebar(activeHref) {
  const usuario = DB.usuarioActual();
  if (!usuario) return;

  const current = window.location.pathname.split('/').pop();

  const links = NAV_LINKS.map(l => {
    const isActive = (activeHref || current) === l.href;
    return `<a href="${l.href}" class="${isActive ? 'active' : ''}">${l.label}</a>`;
  }).join('');

  const sidebarHtml = `
    <div class="sidebar__brand">
      <span class="mark"></span>
      <h1>GymTrack</h1>
    </div>
    <div class="sidebar__user">
      Hola,
      <strong>${usuario.nombre.split(' ')[0]}</strong>
    </div>
    <nav>${links}</nav>
    <div class="sidebar__logout">
      <button id="btnLogout">Cerrar sesión</button>
    </div>
  `;

  const sidebarEl = document.getElementById('sidebar');
  sidebarEl.innerHTML = sidebarHtml;

  document.getElementById('btnLogout').addEventListener('click', () => {
    DB.cerrarSesion();
    window.location.href = 'index.html';
  });
}
