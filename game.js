'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// ASTEROIDS — clon clásico en HTML5 Canvas, sin dependencias ni bundler.
// Estructura: una clase por entidad (Bullet, Asteroid, Ship, Particle, PowerUp)
// más un estado global mutable. Física en px/s escalada por dt.
// ═══════════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = 800;   // ancho del canvas (debe coincidir con <canvas> en index.html)
const H = 600;   // alto del canvas  (debe coincidir con <canvas> en index.html)

// ── Input ─────────────────────────────────────────────────────────────────────
// keys: teclas mantenidas (movimiento continuo).
// justPressed: pulsos de un solo frame (disparo, reinicio); pressed() los consume.
const keys = {};
const justPressed = {};

window.addEventListener('keydown', e => {
  // Solo marca pulso si la tecla no estaba ya presionada (ignora el autorepetido)
  justPressed[e.code] = !keys[e.code];
  keys[e.code] = true;
  // Evita que la página haga scroll con las teclas del juego
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
    e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// Devuelve true una vez por pulsación; el pulso se consume al leerlo.
function pressed(code) {
  const val = justPressed[code];
  justPressed[code] = false;
  return val;
}

// ── Utils ─────────────────────────────────────────────────────────────────────
// wrap: mantiene v dentro de [0, max) — espacio toroidal: lo que sale por un
// borde entra por el opuesto.
const wrap  = (v, max) => ((v % max) + max) % max;
const dist  = (a, b)   => Math.hypot(a.x - b.x, a.y - b.y);   // distancia entre dos entidades
const rand  = (min, max) => min + Math.random() * (max - min); // flotante en [min, max)
const randInt = (min, max) => Math.floor(rand(min, max + 1));  // entero en [min, max]

// ── Bullet ────────────────────────────────────────────────────────────────────
// Bala de la nave: viaja en línea recta y se autodestruye tras ttl segundos
// (así no queda rebotando eternamente por el espacio toroidal).
class Bullet {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    const SPEED = 520;  // px/s, constante (no le afecta el power-up "Velocidad")
    this.vx = Math.cos(angle) * SPEED;
    this.vy = Math.sin(angle) * SPEED;
    this.ttl  = 1.1;    // vida útil en segundos (~570 px de alcance)
    this.radius = 2;
    this.dead = false;
  }

  update(dt) {
    this.x = wrap(this.x + this.vx * dt, W);
    this.y = wrap(this.y + this.vy * dt, H);
    this.ttl -= dt;
    if (this.ttl <= 0) this.dead = true;
  }

  draw() {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Asteroid ──────────────────────────────────────────────────────────────────
// Tablas paralelas indexadas por size (1 = pequeño, 2 = mediano, 3 = grande).
// El índice 0 no se usa; existe solo para acceder directamente con RADII[size].
const RADII  = [0, 16, 30, 50];   // radio de colisión por tamaño
const SPEEDS = [0, 85, 55, 32];   // velocidad base por tamaño
const POINTS = [0, 100, 50, 20];  // puntos al destruirlo, por tamaño

class Asteroid {
  constructor(x, y, size = 3) {
    this.x    = x;
    this.y    = y;
    this.size = size;
    this.radius = RADII[size];
    this.points = POINTS[size];   // puntos al destruirlo (la estrella fugaz usa los suyos)
    this.dead = false;

    // Deriva en una dirección aleatoria, con velocidad casi fija por tamaño
    const angle = rand(0, Math.PI * 2);
    const speed = SPEEDS[size] + rand(-15, 15);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.rotSpeed = rand(-1.2, 1.2);   // giro propio, rad/s
    this.rot = rand(0, Math.PI * 2);

    // Polígono irregular
    const n = randInt(8, 13);
    this.verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = this.radius * rand(0.6, 1.0);
      this.verts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }

  update(dt) {
    this.x   = wrap(this.x + this.vx * dt, W);
    this.y   = wrap(this.y + this.vy * dt, H);
    this.rot += this.rotSpeed * dt;
  }

  // Al destruirlo genera dos fragmentos de un tamaño menor (los pequeños no se dividen)
  split() {
    if (this.size <= 1) return [];
    return [
      new Asteroid(this.x, this.y, this.size - 1),
      new Asteroid(this.x, this.y, this.size - 1),
    ];
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(this.verts[0][0], this.verts[0][1]);
    for (let i = 1; i < this.verts.length; i++)
      ctx.lineTo(this.verts[i][0], this.verts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// ── EstrellaFugaz ─────────────────────────────────────────────────────────────
// Asteroide especial: cruza la pantalla al triple de velocidad y tiene vida
// limitada — si nadie la derriba antes de agotar su ttl, se desvanece sola
// en chispas cian. Al dispararle se parte en dos fugaces menores (las
// pequeñas ya no se dividen). Aparece periódicamente: ver fugazTimer.
const FUGAZ_SPEED_MULT = 3;              // velocidad respecto a un asteroide normal
const FUGAZ_TTL        = 7;              // seg. de vida cuando aparece
const FUGAZ_POINTS     = [0, 250, 150];  // puntos por tamaño (nunca nace grande)
const FUGAZ_COLOR      = '34, 211, 238'; // cian en formato "R,G,B" (partículas)

class EstrellaFugaz extends Asteroid {
  constructor(x, y, size = 2, ttl = FUGAZ_TTL) {
    super(x, y, size);
    this.points = FUGAZ_POINTS[size];   // puntuación propia, mejor que la del asteroide común
    this.color  = FUGAZ_COLOR;          // color de su estela y de su explosión

    // Sustituye la deriva del asteroide base por una velocidad triplicada
    const angle = rand(0, Math.PI * 2);
    const speed = SPEEDS[size] * FUGAZ_SPEED_MULT + rand(-20, 20);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.ttl = ttl;   // seg. que le quedan antes de desvanecerse
  }

  update(dt) {
    super.update(dt);
    this.ttl -= dt;
    if (this.ttl <= 0) {
      // Nadie la derribó: desaparece por sí sola en una pequeña lluvia de chispas
      this.dead = true;
      explode(this.x, this.y, 6, FUGAZ_COLOR);
      return;
    }
    // Estela: suelta chispas cian que se quedan atrás mientras cruza la pantalla
    // (las Particle no hacen wrap, así que la estela no "teleporta" en los bordes)
    if (Math.random() < 0.5)
      particles.push(new Particle(this.x, this.y, FUGAZ_COLOR));
  }

  // Se parte en dos fugaces de un tamaño menor: heredan su rumbo (con desvío)
  // y un ttl reducido. Las pequeñas mueren sin partirse, como los asteroides.
  split() {
    if (this.size <= 1) return [];
    const base = Math.atan2(this.vy, this.vx);
    return [-1, 1].map(signo => {
      const frag = new EstrellaFugaz(this.x, this.y, this.size - 1, Math.max(2, this.ttl * 0.5));
      const ang   = base + signo * rand(0.35, 0.9);
      const speed = SPEEDS[frag.size] * FUGAZ_SPEED_MULT + rand(-20, 20);
      frag.vx = Math.cos(ang) * speed;
      frag.vy = Math.sin(ang) * speed;
      return frag;
    });
  }

  // Como un asteroide, pero en cian y fundiéndose a transparente durante los
  // últimos 2 s de vida para avisar de que está a punto de desaparecer.
  draw() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.ttl / 2);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(this.verts[0][0], this.verts[0][1]);
    for (let i = 1; i < this.verts.length; i++)
      ctx.lineTo(this.verts[i][0], this.verts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// ── Ship ──────────────────────────────────────────────────────────────────────
// Nave del jugador. Todos sus temporizadores (invincible, shootCooldown,
// speedTimer) cuentan hacia atrás en segundos y se apagan solos al llegar a 0.
class Ship {
  constructor() { this.reset(); }

  // Vuelve a la posición inicial; se usa al iniciar partida, al subir de nivel
  // y al reaparecer tras morir. También cancela el power-up "Velocidad".
  reset() {
    this.x      = W / 2;
    this.y      = H / 2;
    this.angle  = -Math.PI / 2;
    this.vx     = 0;
    this.vy     = 0;
    this.radius = 12;
    this.thrusting     = false;
    this.invincible    = 3;
    this.shootCooldown = 0;
    this.dead          = false;
  }

  update(dt) {
    if (this.dead) return;
    if (this.invincible    > 0) this.invincible    -= dt;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.speedTimer    > 0) this.speedTimer    -= dt;

    const ROT   = 3.5;   // rad/s
    const THRUST = 260;  // px/s²
    const DRAG   = 0.987;

    if (keys['ArrowLeft'])  this.angle -= ROT * dt;
    if (keys['ArrowRight']) this.angle += ROT * dt;

    // Propulsión: acelera en la dirección a la que apunta la nariz
    this.thrusting = !!keys['ArrowUp'];
    if (this.thrusting) {
      this.vx += Math.cos(this.angle) * THRUST * dt;
      this.vy += Math.sin(this.angle) * THRUST * dt;
    }

    // Frenado suave + avance (envuelto en los bordes de la pantalla)
    this.vx *= DRAG;
    this.vy *= DRAG;
    this.x = wrap(this.x + this.vx * dt, W);
    this.y = wrap(this.y + this.vy * dt, H);
  }

  // Devuelve las balas a crear ([] si está en cooldown o muerta).
  // El disparo sale desde la nariz de la nave, no desde su centro.
  tryShoot() {
    if (this.shootCooldown > 0 || this.dead) return [];
    this.shootCooldown = 0.2;   // cadencia: una bala cada 0.2 s
    const NOSE = 21;            // distancia del centro a la punta
    const ox = this.x + Math.cos(this.angle) * NOSE;
    const oy = this.y + Math.sin(this.angle) * NOSE;
    return [new Bullet(ox, oy, this.angle)];
  }

  draw() {
    if (this.dead) return;
    // Parpadeo durante invencibilidad de reaparición
    if (this.invincible > 0 && Math.floor(this.invincible * 8) % 2 === 0) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';

    // Silueta clásica: triángulo con muesca trasera
    ctx.beginPath();
    ctx.moveTo( 20,  0);   // nariz
    ctx.lineTo(-12, -9);   // ala izquierda
    ctx.lineTo( -7,  0);   // muesca trasera
    ctx.lineTo(-12,  9);   // ala derecha
    ctx.closePath();
    ctx.stroke();

    // Llama del propulsor
    if (this.thrusting && Math.random() > 0.35) {
      ctx.beginPath();
      ctx.moveTo(-8, -4);
      ctx.lineTo(-8 - rand(6, 14), 0);
      ctx.lineTo(-8,  4);
      ctx.strokeStyle = 'rgba(255, 130, 0, 0.85)';
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ── Partículas (explosión) ────────────────────────────────────────────────────
// Restos de una explosión: salen en direcciones aleatorias y se desvanecen.
// Única entidad que NO hace wrap en los bordes (vuela recta hasta morir).
// color es "R,G,B" para poder interpolarlo con la transparencia en draw().
class Particle {
  constructor(x, y, color = '255,255,255') {
    this.x  = x;
    this.y  = y;
    this.color = color;
    const angle = rand(0, Math.PI * 2);
    const speed = rand(30, 130);
    this.vx   = Math.cos(angle) * speed;
    this.vy   = Math.sin(angle) * speed;
    this.life = rand(0.4, 1.1);
    this.ttl  = this.life;
    this.dead = false;
  }

  update(dt) {
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.ttl -= dt;
    if (this.ttl <= 0) this.dead = true;
  }

  draw() {
    const alpha = this.ttl / this.life;
    ctx.strokeStyle = `rgba(${this.color},${alpha.toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * 0.05, this.y - this.vy * 0.05);
    ctx.stroke();
  }
}

// ── Estado del juego ──────────────────────────────────────────────────────────
let ship, bullets, asteroids, particles;
let score, lives, level;
let state;      // 'playing' | 'dead' | 'gameover'
let deadTimer;

function spawnAsteroids(count) {
  const SAFE_DIST = 130;
  for (let i = 0; i < count; i++) {
    let x, y;
    do {
      x = rand(0, W);
      y = rand(0, H);
    } while (Math.hypot(x - W / 2, y - H / 2) < SAFE_DIST);
    asteroids.push(new Asteroid(x, y, 3));
  }
}

function spawnPowerUp() {
  const SAFE_DIST = 150;
  let x, y;
  do {
    x = rand(0, W);
    y = rand(0, H);
  } while (Math.hypot(x - ship.x, y - ship.y) < SAFE_DIST);
  powerups.push(new PowerUp(x, y, 'velocidad'));
}

// Coloca un power-up en un punto aleatorio a SAFE_DIST de la nave: nunca
// aparece encima de ella; siempre da tiempo a verlo y llegar.
function spawnPowerUp() {
  const SAFE_DIST = 150;
  let x, y;
  do {
    x = rand(0, W);
    y = rand(0, H);
  } while (Math.hypot(x - ship.x, y - ship.y) < SAFE_DIST);
  powerups.push(new PowerUp(x, y, 'velocidad'));
}

// Suelta una estrella fugaz en un punto aleatorio lejos de la nave: a la
// velocidad que va, conviene verla venir y no aparecerle encima.
function spawnEstrellaFugaz() {
  const SAFE_DIST = 150;
  let x, y;
  do {
    x = rand(0, W);
    y = rand(0, H);
  } while (Math.hypot(x - ship.x, y - ship.y) < SAFE_DIST);
  asteroids.push(new EstrellaFugaz(x, y, 2));
}

// Reinicia todo y arranca una partida nueva (también al pulsar Espacio en game over).
function initGame() {
  ship          = new Ship();
  bullets   = [];
  asteroids = [];
  particles = [];
  powerups  = [];
  score  = 0;
  lives  = 3;
  level  = 1;
  state  = 'playing';
  spawnAsteroids(4);
}

// Sube de nivel: limpia la pantalla, recoloca la nave y añade un asteroide más.
function nextLevel() {
  level++;
  bullets   = [];
  particles = [];
  powerups  = [];
  ship.reset();
  spawnAsteroids(3 + level);
}

function explode(x, y, count = 8) {
  for (let i = 0; i < count; i++) particles.push(new Particle(x, y));
}

// La nave choca: explota, pierde una vida y pasa a 'dead' (o 'gameover' si era la última).
function killShip() {
  explode(ship.x, ship.y, 14);
  ship.dead = true;
  lives--;
  if (lives <= 0) {
    state = 'gameover';
  } else {
    state     = 'dead';
    deadTimer = 2;
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
// Avanza la simulación un frame; dt llega en segundos (ya acotado en el loop).
// Los dos primeros estados cortan con return: solo 'playing' corre toda la lógica.
function update(dt) {
  // GAME OVER: solo siguen las partículas; se reinicia con Espacio
  if (state === 'gameover') {
    if (pressed('Space')) initGame();
    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => !p.dead);
    return;
  }

  // MUERTE: la nave espera deadTimer (2 s) mientras el mundo sigue moviéndose
  if (state === 'dead') {
    deadTimer -= dt;
    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => !p.dead);
    asteroids.forEach(a => a.update(dt));
    powerups.forEach(p => p.update(dt));
    powerups  = powerups.filter(p => !p.dead);
    if (deadTimer <= 0) { state = 'playing'; ship.reset(); }
    return;
  }

  // ── Estado 'playing': lógica completa ──

  // Disparar
  if (pressed('Space')) {
    bullets.push(...ship.tryShoot());
  }

  // Actualizar todas las entidades
  ship.update(dt);
  bullets.forEach(b => b.update(dt));
  asteroids.forEach(a => a.update(dt));
  particles.forEach(p => p.update(dt));
  powerups.forEach(p => p.update(dt));

  // Retirar las entidades marcadas como muertas este frame
  bullets   = bullets.filter(b => !b.dead);
  particles = particles.filter(p => !p.dead);
  powerups  = powerups.filter(p => !p.dead);

  // Bala vs asteroide: ambos mueren y el grande se parte en dos fragmentos
  const newAsteroids = [];
  for (const b of bullets) {
    for (const a of asteroids) {
      if (!a.dead && !b.dead && dist(b, a) < a.radius) {
        b.dead = true;
        a.dead = true;
        score += a.points;   // cada asteroide lleva sus puntos (la fugaz da más)
        explode(a.x, a.y, a.size * 5, a.color ?? '255,255,255');   // la fugaz explota en cian
        newAsteroids.push(...a.split());
      }
    }
  }
  asteroids = asteroids.filter(a => !a.dead).concat(newAsteroids);
  bullets   = bullets.filter(b => !b.dead);

  // Nave vs asteroide: con invencibilidad activa la nave atraviesa todo.
  // El radio del asteroide se reduce (×0.82) porque su polígono es irregular.
  if (ship.invincible <= 0) {
    for (const a of asteroids) {
      if (dist(ship, a) < ship.radius + a.radius * 0.82) {
        killShip();
        break;
      }
    }
  }

  // Nivel completado
  if (asteroids.length === 0) nextLevel();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
// Dibuja una navecita en miniatura para representar una vida en el HUD.
function drawLifeIcon(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth   = 1.2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo( 9,  0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-3,  0);
  ctx.lineTo(-6,  5);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// Marcador superior: score a la izquierda, nivel al centro, vidas a la derecha.
function drawHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = '15px monospace';

  ctx.textAlign = 'left';
  ctx.fillText(`SCORE  ${score}`, 14, 26);

  ctx.textAlign = 'center';
  ctx.fillText(`NIVEL ${level}`, W / 2, 26);

  for (let i = 0; i < lives; i++)
    drawLifeIcon(W - 16 - i * 22, 18);

}

function drawOverlay(title, sub) {
  ctx.textAlign   = 'center';
  ctx.fillStyle   = '#fff';
  ctx.font        = 'bold 46px monospace';
  ctx.fillText(title, W / 2, H / 2 - 18);
  ctx.font        = '18px monospace';
  ctx.fillStyle   = 'rgba(255,255,255,0.65)';
  ctx.fillText(sub, W / 2, H / 2 + 22);
}

// Renderiza un frame completo: fondo, entidades, HUD y overlays.
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  particles.forEach(p => p.draw());
  asteroids.forEach(a => a.draw());
  bullets.forEach(b => b.draw());
  ship.draw();

  drawHUD();

  if (state === 'gameover')
    drawOverlay('GAME OVER', `PUNTAJE: ${score}   —   ESPACIO PARA REINICIAR`);
}

// ── Loop principal ────────────────────────────────────────────────────────────
let lastTime = null;

function loop(ts) {
  // dt en segundos, acotado a 0.05 s: si la pestaña pierde el foco o hay un
  // bajón de FPS, la física no da un salto gigante al volver.
  const dt = lastTime === null ? 0 : Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// Arranque
initGame();
requestAnimationFrame(loop);
