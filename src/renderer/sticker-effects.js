/*
  Zenlo – trình quản lí hội thoại Zalo

  Effects of stickers. An animated sticker is layers on top of each other: a motion of the
  picture, an effect of particles (rain, snow, hearts…), an effect of light (glow, halo…) and
  words, each one optional; a frame (white border, stamp…) is drawn round the picture itself.
  Every effect draws in a 120 × 120 box, scaled to the sticker's side; the picture
  sits in a square of BOX in its middle, with room around it for the effects.
  Effects depend only on the phase p of the loop (0 to 1), and every periodic term turns a whole
  number of times per loop, so the last frame runs into the first without a jump.
*/

export const FRAME_COUNT = 50
export const FRAME_MS = 40 // 25 frames a second; some players slow down frames under 20 ms
export const MOTION_DURATION = FRAME_COUNT * FRAME_MS
const BOX = 92
export const MOTION_SCALE = BOX / 120
// The frame used for a sticker's still picture (some effects start from nothing at frame 0)
export const THUMBNAIL_FRAME = 15

const PI2 = Math.PI * 2
const rand = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const wave = (p, turns = 1, shift = 0) => Math.sin(PI2 * (p * turns + shift))
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u))
// Goes a little past the end, then back (for things popping in)
const easeOutBack = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2
const PARTY = ['#F0997B', '#FAC775', '#5DCAA5', '#85B7EB', '#ED93B1']
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'

// ---------- Shapes ----------

function star (c, x, y, r) {
  c.beginPath()
  c.moveTo(x, y - r)
  c.quadraticCurveTo(x, y, x + r, y)
  c.quadraticCurveTo(x, y, x, y + r)
  c.quadraticCurveTo(x, y, x - r, y)
  c.quadraticCurveTo(x, y, x, y - r)
  c.fill()
}

function heart (c, x, y, s) {
  c.beginPath()
  c.moveTo(x, y + s * 0.9)
  c.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.6, y - s * 1.4, x, y - s * 0.5)
  c.bezierCurveTo(x + s * 0.6, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9)
  c.fill()
}

function dot (c, x, y, r) {
  c.beginPath()
  c.arc(x, y, r, 0, PI2)
  c.fill()
}

// Things falling from the top: i-th of them at phase p, `turns` times down per loop
function falling (i, p, turns = 1) {
  return { y: ((p * turns + rand(i, 2)) % 1) * 140 - 12, x: rand(i, 1) * 124 - 2 }
}

// Things rising from the bottom
function rising (i, p) {
  const t = (p + rand(i, 2)) % 1
  return { t, y: 118 - t * 130, x: 12 + rand(i, 1) * 96 + 6 * wave(p, 2, rand(i, 3)) }
}

// ---------- Motions of the picture ----------

export const MOTIONS = [
  { id: 'still', label: 'Đứng yên' },
  { id: 'breathe', label: 'Thở', pose: (p) => ({ s: 1 + 0.05 * wave(p) }) },
  {
    id: 'float',
    label: 'Lơ lửng',
    pose: (p) => {
      const y = -7 * wave(p) - 4
      return { y, s: 0.9, shadow: 1 + y / 40 }
    }
  },
  {
    id: 'bounce',
    label: 'Nảy',
    pose: (p) => {
      // A throw: slow at the top, fast at the ground, squashed when it lands
      const h = 4 * p * (1 - p)
      const d = Math.min(p, 1 - p)
      const k = d < 0.07 ? 1 - d / 0.07 : 0
      return { y: 6 - 26 * h, s: 0.85, sx: 1 + 0.13 * k, sy: 1 - 0.13 * k, shadow: 1 - h * 0.35 }
    }
  },
  { id: 'sway', label: 'Lắc lư', pose: (p) => ({ r: 0.14 * wave(p), s: 0.94 }) },
  {
    id: 'jelly',
    label: 'Thạch',
    pose: (p) => {
      const k = wave(p, 2)
      return { sx: 1 + 0.09 * k, sy: 1 - 0.09 * k, s: 0.92 }
    }
  },
  {
    id: 'heartbeat',
    label: 'Nhịp tim',
    pose: (p) => {
      const beat = (x) => Math.max(0, Math.sin(Math.PI * x))
      const k = p < 0.15 ? beat(p / 0.15) : (p > 0.22 && p < 0.37 ? beat((p - 0.22) / 0.15) * 0.7 : 0)
      return { s: 0.92 * (1 + 0.12 * k) }
    }
  },
  {
    id: 'flip',
    label: 'Lật',
    pose: (p) => {
      const k = Math.cos(PI2 * p)
      return { sx: k, filter: k < 0 ? 'brightness(0.55)' : '' }
    }
  },
  { id: 'spin', label: 'Xoay tròn', pose: (p) => ({ r: PI2 * p, s: 0.84, center: true }) },
  {
    id: 'shake',
    label: 'Rung giận',
    pose: (p) => {
      const frame = Math.round(p * FRAME_COUNT)
      return { x: (frame % 2 ? 2.5 : -2.5) * (p % 0.5 < 0.3 ? 1 : 0.3), s: 0.94 }
    }
  },
  {
    id: 'tilt',
    label: 'Nghiêng đầu',
    pose: (p) => {
      const u = p < 0.5 ? p * 2 : 2 - p * 2
      return { r: -0.18 + 0.36 * ease(u), s: 0.9 }
    }
  },
  {
    id: 'pop',
    label: 'Bật ra',
    pose: (p) => {
      let s
      if (p < 0.25) {
        const u = p / 0.25
        s = u < 0.6 ? (u / 0.6) * 1.15 : 1.15 - 0.15 * ((u - 0.6) / 0.4)
      } else if (p < 0.85) s = 1
      else s = 1 - (p - 0.85) / 0.15
      return { s: Math.max(0.01, s) * 0.92, center: true }
    }
  },
  {
    id: 'wiggle',
    label: 'Nhảy múa',
    pose: (p) => ({ x: 8 * wave(p, 2), r: -0.12 * wave(p, 2), y: -4 * Math.abs(wave(p, 2)), s: 0.88 })
  },
  {
    id: 'hop',
    label: 'Nhảy qua lại',
    pose: (p) => {
      // Two hops a loop, landing on the left and on the right
      const u = (p * 2) % 1
      const h = 4 * u * (1 - u)
      const k = Math.min(u, 1 - u) < 0.06 ? 1 - Math.min(u, 1 - u) / 0.06 : 0
      return { x: 14 * Math.cos(PI2 * p), y: 4 - 18 * h, s: 0.8, sx: 1 + 0.12 * k, sy: 1 - 0.12 * k, shadow: 1 - h * 0.4 }
    }
  },
  {
    id: 'run',
    label: 'Chạy ngang',
    pose: (p) => ({ x: -96 + 192 * p, y: 2 - 4 * Math.abs(wave(p, 6)), r: 0.1 + 0.04 * wave(p, 12), s: 0.78, shadow: 0.8 })
  },
  {
    id: 'nod',
    label: 'Gật đầu',
    pose: (p) => {
      const k = Math.max(0, wave(p, 2))
      return { y: 3 * k, sy: 1 - 0.07 * k, s: 0.92 }
    }
  },
  {
    id: 'headshake',
    label: 'Lắc đầu',
    pose: (p) => {
      if (p >= 0.5) return { s: 0.92 }
      const u = p * 2
      const k = Math.sin(PI2 * u * 4) * (1 - u * 0.4)
      return { x: 5 * k, r: 0.05 * k, s: 0.92 }
    }
  },
  {
    id: 'drop',
    label: 'Rơi xuống',
    pose: (p) => {
      let y = 6
      let alpha = 1
      if (p < 0.3) y = -130 + 136 * (p / 0.3) ** 2
      else if (p < 0.5) {
        const v = (p - 0.3) / 0.2
        y = 6 - 56 * v * (1 - v)
      } else if (p < 0.62) {
        const v = (p - 0.5) / 0.12
        y = 6 - 20 * v * (1 - v)
      } else if (p > 0.88) alpha = 1 - (p - 0.88) / 0.12
      // Squashed where it lands
      const land = Math.min(Math.abs(p - 0.3), Math.abs(p - 0.5), Math.abs(p - 0.62))
      const k = land < 0.025 ? 1 - land / 0.025 : 0
      return { y, alpha, s: 0.88, sx: 1 + 0.14 * k, sy: 1 - 0.14 * k, shadow: Math.max(0.15, 1 - (6 - y) / 140) * alpha }
    }
  },
  {
    id: 'zoom',
    label: 'Giật phóng to',
    pose: (p) => {
      const spike = (u) => (u < 0 || u >= 0.3 ? 0 : (u < 0.05 ? u / 0.05 : 1 - (u - 0.05) / 0.25))
      const k = spike(p) + spike(p - 0.5)
      const frame = Math.round(p * FRAME_COUNT)
      return { s: 0.84 * (1 + 0.3 * k), x: k > 0.5 ? (frame % 2 ? 1.5 : -1.5) : 0, center: true }
    }
  },
  {
    id: 'slide',
    label: 'Trượt vào',
    pose: (p) => {
      if (p < 0.25) {
        const u = p / 0.25
        return { x: 120 * (1 - easeOutBack(u)), r: -0.15 * (1 - u), s: 0.9, shadow: 1 }
      }
      if (p < 0.8) return { s: 0.9, shadow: 1 }
      const u = (p - 0.8) / 0.2
      return { x: -120 * u * u, r: 0.15 * u, s: 0.9, shadow: 1 }
    }
  },
  {
    id: 'quake',
    label: 'Động đất',
    pose: (p) => {
      const frame = Math.round(p * FRAME_COUNT)
      return { x: (rand(frame, 1) - 0.5) * 6, y: (rand(frame, 2) - 0.5) * 4, r: (rand(frame, 3) - 0.5) * 0.08, s: 0.9, shadow: 1 }
    }
  },
  {
    id: 'flyaway',
    label: 'Bay lên',
    pose: (p) => {
      const u = Math.max(0, (p - 0.1) / 0.9)
      const y = 6 - 150 * u * u
      return { y, x: 6 * wave(p, 3), r: 0.06 * wave(p, 3), alpha: Math.min(1, p / 0.1), s: 0.88, shadow: Math.max(0, 1 - (6 - y) / 60) }
    }
  },
  {
    id: 'spring',
    label: 'Lò xo',
    pose: (p) => {
      // Pressed down, then let go: it wobbles back to rest
      const u = (p * 2) % 1
      let k
      if (u < 0.12) k = -0.3 * Math.sin((Math.PI / 2) * (u / 0.12))
      else {
        const v = (u - 0.12) / 0.88
        k = -0.3 * Math.exp(-4 * v) * Math.cos(PI2 * 3 * v)
      }
      return { sy: 1 + k, sx: 1 - k * 0.5, s: 0.88, shadow: 1 }
    }
  },
  { id: 'wavy', label: 'Uốn lượn', pose: (p) => ({ wave: 4, wavePhase: p * 2, s: 0.9 }) }
]

// ---------- Particles ----------

export const PARTICLES = [
  { id: 'none', label: 'Không' },
  {
    id: 'rain',
    label: 'Mưa rơi',
    front (c, p) {
      c.strokeStyle = '#85B7EB'
      c.lineWidth = 1.4
      c.lineCap = 'round'
      for (let i = 0; i < 16; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        const left = x - y * 0.2
        c.beginPath()
        c.moveTo(left, y)
        c.lineTo(left - 2.4, y + 12)
        c.stroke()
      }
    }
  },
  {
    id: 'snow',
    label: 'Tuyết rơi',
    front (c, p) {
      c.fillStyle = '#fff'
      c.strokeStyle = 'rgba(0, 0, 0, 0.2)'
      c.lineWidth = 0.5
      for (let i = 0; i < 18; i++) {
        const { x, y } = falling(i, p)
        c.beginPath()
        c.arc(x + 5 * wave(p, 2, rand(i, 3)), y, 1.2 + rand(i, 4) * 2.4, 0, PI2)
        c.fill()
        c.stroke()
      }
    }
  },
  {
    id: 'glitter',
    label: 'Kim tuyến',
    front (c, p) {
      for (let i = 0; i < 16; i++) {
        const a = Math.max(0, wave(p, 2, rand(i, 3)))
        if (a < 0.05) continue
        c.globalAlpha = a
        c.fillStyle = i % 3 ? '#FAC775' : '#fff'
        star(c, 8 + rand(i, 1) * 104, 8 + rand(i, 2) * 104, 1.5 + 6 * a)
      }
    }
  },
  {
    id: 'hearts',
    label: 'Tim bay lên',
    front (c, p) {
      for (let i = 0; i < 8; i++) {
        const { t, x, y } = rising(i, p)
        c.globalAlpha = Math.min(1, t * 8, (1 - t) * 5)
        c.fillStyle = i % 2 ? '#ED93B1' : '#E24B4A'
        heart(c, x, y, 5 + rand(i, 4) * 3)
      }
    }
  },
  {
    id: 'confetti',
    label: 'Pháo giấy',
    front (c, p) {
      for (let i = 0; i < 20; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        c.save()
        c.translate(x + 4 * wave(p, 2, rand(i, 5)), y)
        c.rotate(PI2 * p * 2 * (i % 2 ? 1 : -1) + rand(i, 3) * 6)
        c.scale(1, Math.cos(PI2 * p * 3 + rand(i, 4) * 6))
        c.fillStyle = PARTY[i % PARTY.length]
        c.fillRect(-3, -1.8, 6, 3.6)
        c.restore()
      }
    }
  },
  {
    id: 'sakura',
    label: 'Hoa anh đào',
    front (c, p) {
      c.fillStyle = '#F4C0D1'
      c.strokeStyle = '#ED93B1'
      c.lineWidth = 0.6
      for (let i = 0; i < 11; i++) {
        const { x, y } = falling(i, p)
        c.save()
        c.translate(x + 10 * wave(p, 1, rand(i, 3)), y)
        c.rotate(PI2 * p * (i % 2 ? 1 : -1) + rand(i, 4) * 6)
        c.beginPath()
        c.ellipse(0, 0, 4.2, 2.5, 0, 0, PI2)
        c.fill()
        c.stroke()
        c.restore()
      }
    }
  },
  {
    id: 'leaves',
    label: 'Lá thu',
    front (c, p) {
      for (let i = 0; i < 10; i++) {
        const { x, y } = falling(i, p)
        c.save()
        c.translate(x + 12 * wave(p, 1, rand(i, 3)), y)
        c.rotate(PI2 * p * (i % 2 ? 1 : -1) + rand(i, 4) * 6)
        c.fillStyle = ['#D85A30', '#EF9F27', '#BA7517'][i % 3]
        c.beginPath()
        c.moveTo(0, -5)
        c.quadraticCurveTo(4, 0, 0, 5)
        c.quadraticCurveTo(-4, 0, 0, -5)
        c.fill()
        c.restore()
      }
    }
  },
  {
    id: 'bubbles',
    label: 'Bong bóng',
    front (c, p) {
      for (let i = 0; i < 9; i++) {
        const { x, y } = rising(i, p)
        const r = 3 + rand(i, 4) * 5
        c.strokeStyle = '#85B7EB'
        c.lineWidth = 1
        c.beginPath()
        c.arc(x, y, r, 0, PI2)
        c.stroke()
        c.fillStyle = 'rgba(255, 255, 255, 0.8)'
        dot(c, x - r * 0.4, y - r * 0.4, r * 0.25)
      }
    }
  },
  {
    id: 'fireflies',
    label: 'Đom đóm',
    front (c, p) {
      c.shadowColor = '#FAC775'
      // Shadows ignore the canvas's scale: sized by hand to the sticker's side
      c.shadowBlur = 16 * c.getTransform().a
      c.fillStyle = '#FAEEDA'
      for (let i = 0; i < 10; i++) {
        c.globalAlpha = 0.3 + 0.7 * Math.max(0, wave(p, 2, rand(i, 3)))
        dot(c, 60 + 50 * wave(p, 1 + (i % 2), rand(i, 1)), 60 + 45 * wave(p, 1 + ((i >> 1) % 2), rand(i, 2)), 2)
      }
    }
  },
  {
    id: 'coins',
    label: 'Tiền rơi',
    front (c, p) {
      c.font = 'bold 6px sans-serif'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      for (let i = 0; i < 10; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        c.save()
        c.translate(x, y)
        c.scale(Math.cos(PI2 * (p * 2 + rand(i, 4))), 1)
        c.fillStyle = '#EF9F27'
        c.strokeStyle = '#854F0B'
        c.lineWidth = 0.8
        c.beginPath()
        c.arc(0, 0, 4.5, 0, PI2)
        c.fill()
        c.stroke()
        c.fillStyle = '#854F0B'
        c.fillText('$', 0, 0.5)
        c.restore()
      }
    }
  },
  {
    id: 'meteors',
    label: 'Sao băng',
    front (c, p) {
      c.lineWidth = 2
      c.lineCap = 'round'
      for (let b = 0; b < 2; b++) {
        const t = (p + b / 2) % 1
        if (t > 0.35) continue
        const u = t / 0.35
        const x = 112 - u * 120
        const y = 6 + b * 18 + u * 40
        const tail = c.createLinearGradient(x, y, x + 22, y - 8)
        tail.addColorStop(0, 'rgba(255, 255, 255, 1)')
        tail.addColorStop(1, 'rgba(255, 255, 255, 0)')
        c.strokeStyle = tail
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x + 22, y - 8)
        c.stroke()
        c.fillStyle = '#FAC775'
        dot(c, x, y, 2)
      }
    }
  },
  {
    id: 'emoji',
    label: 'Mưa emoji',
    front (c, p) {
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      for (let i = 0; i < 9; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        c.font = `${10 + rand(i, 4) * 6}px ${EMOJI_FONT}`
        c.save()
        c.translate(x, y)
        c.rotate(0.4 * wave(p, 1, rand(i, 3)))
        c.fillText('😂', 0, 0)
        c.restore()
      }
    }
  },
  {
    id: 'zzz',
    label: 'Ngủ zzz',
    front (c, p) {
      c.fillStyle = '#B5D4F4'
      c.strokeStyle = '#26215C'
      c.lineWidth = 0.8
      c.textAlign = 'center'
      for (let i = 0; i < 3; i++) {
        const t = (p + i / 3) % 1
        c.globalAlpha = Math.min(1, t * 6, (1 - t) * 3)
        c.font = `bold ${8 + t * 9}px sans-serif`
        c.strokeText('z', 88 + t * 22, 30 - t * 26)
        c.fillText('z', 88 + t * 22, 30 - t * 26)
      }
    }
  },
  {
    id: 'sweat',
    label: 'Giọt mồ hôi',
    front (c, p) {
      c.fillStyle = '#85B7EB'
      for (let i = 0; i < 2; i++) {
        const t = (p * 2 + i * 0.5) % 1
        const x = [98, 22][i]
        const y = 24 + t * 30
        c.globalAlpha = Math.min(1, (1 - t) * 3)
        c.beginPath()
        c.moveTo(x, y - 6)
        c.quadraticCurveTo(x + 4, y, x, y + 3)
        c.quadraticCurveTo(x - 4, y, x, y - 6)
        c.fill()
      }
    }
  },
  {
    id: 'anger',
    label: 'Dấu giận',
    front (c, p) {
      const k = 0.6 + 0.4 * wave(p, 4)
      c.strokeStyle = '#E24B4A'
      c.lineWidth = 2.4
      c.lineCap = 'round'
      c.translate(98, 18)
      c.scale(k, k)
      c.beginPath()
      for (let a = 0; a < 4; a++) {
        c.rotate(Math.PI / 2)
        c.moveTo(3, 0)
        c.lineTo(10, 0)
      }
      c.stroke()
    }
  },
  {
    id: 'butterflies',
    label: 'Bướm bay',
    front (c, p) {
      const colors = ['#ED93B1', '#85B7EB', '#FAC775', '#5DCAA5', '#F0997B']
      for (let i = 0; i < 5; i++) {
        c.save()
        // A figure of eight around the picture
        c.translate(60 + 48 * wave(p, 1, rand(i, 1)), 58 + 38 * wave(p, 2, rand(i, 2)))
        c.rotate(0.3 * wave(p, 1, rand(i, 3)))
        c.fillStyle = '#444441'
        c.fillRect(-0.6, -3.5, 1.2, 7)
        c.scale(Math.max(0.2, Math.abs(Math.cos(PI2 * p * 10 + i))), 1)
        c.fillStyle = colors[i]
        for (const side of [-1, 1]) {
          c.beginPath()
          c.ellipse(side * 3.6, -1.8, 3.6, 2.8, side * 0.5, 0, PI2)
          c.fill()
          c.beginPath()
          c.ellipse(side * 2.6, 2.6, 2.4, 2, -side * 0.4, 0, PI2)
          c.fill()
        }
        c.restore()
      }
    }
  },
  {
    id: 'notes',
    label: 'Nốt nhạc',
    front (c, p) {
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      for (let i = 0; i < 7; i++) {
        const { t, x, y } = rising(i, p)
        c.globalAlpha = Math.min(1, t * 8, (1 - t) * 4)
        c.fillStyle = PARTY[i % PARTY.length]
        c.font = `bold ${11 + rand(i, 4) * 5}px "Segoe UI Symbol", "Segoe UI", sans-serif`
        c.save()
        c.translate(x, y)
        c.rotate(0.3 * wave(p, 2, rand(i, 3)))
        c.fillText(i % 2 ? '♪' : '♫', 0, 0)
        c.restore()
      }
    }
  },
  {
    id: 'dizzy',
    label: 'Choáng',
    front (c, p) {
      // Stars turning round the head
      for (let k = 0; k < 5; k++) {
        const a = PI2 * (p * 2 + k / 5)
        const near = (Math.sin(a) + 1) / 2
        c.globalAlpha = 0.45 + 0.55 * near
        c.fillStyle = k % 2 ? '#FAC775' : '#EF9F27'
        star(c, 60 + 30 * Math.cos(a), 16 + 7 * Math.sin(a), 3 + 2 * near)
      }
    }
  },
  {
    id: 'dandelion',
    label: 'Bồ công anh',
    front (c, p) {
      c.lineCap = 'round'
      for (let i = 0; i < 8; i++) {
        const t = (p + rand(i, 2)) % 1
        const x = 6 + rand(i, 1) * 60 + t * 50 + 4 * wave(p, 2, rand(i, 3))
        const y = 112 - t * 116
        c.globalAlpha = Math.min(1, t * 8, (1 - t) * 5)
        c.save()
        c.translate(x, y)
        c.rotate(0.4 * wave(p, 1, rand(i, 4)))
        c.strokeStyle = '#888780'
        c.lineWidth = 0.7
        c.beginPath()
        c.moveTo(0, 0)
        c.lineTo(0, 6)
        c.stroke()
        c.strokeStyle = '#B4B2A9'
        c.beginPath()
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI + (Math.PI * k) / 6
          c.moveTo(0, 0)
          c.lineTo(Math.cos(a) * 4, Math.sin(a) * 4)
        }
        c.stroke()
        c.restore()
      }
    }
  },
  {
    id: 'petals',
    label: 'Cánh hoa hồng',
    front (c, p) {
      for (let i = 0; i < 10; i++) {
        const { x, y } = falling(i, p)
        c.save()
        c.translate(x + 14 * wave(p, 1, rand(i, 3)), y)
        c.rotate(PI2 * p * (i % 2 ? 1 : -1) + rand(i, 4) * 6)
        c.scale(1, 0.5 + 0.5 * Math.abs(wave(p, 2, rand(i, 5))))
        c.fillStyle = ['#E24B4A', '#D4537E', '#A32D2D'][i % 3]
        c.beginPath()
        c.moveTo(0, 4)
        c.bezierCurveTo(-6, 0, -3, -5, 0, -2.5)
        c.bezierCurveTo(3, -5, 6, 0, 0, 4)
        c.fill()
        c.restore()
      }
    }
  },
  {
    id: 'candy',
    label: 'Kẹo rơi',
    front (c, p) {
      for (let i = 0; i < 9; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        c.save()
        c.translate(x, y)
        c.rotate(PI2 * p * (i % 2 ? 1 : -1) + rand(i, 4) * 6)
        c.fillStyle = PARTY[i % PARTY.length]
        for (const side of [-1, 1]) {
          c.beginPath()
          c.moveTo(side * 3, 0)
          c.lineTo(side * 7, -3)
          c.lineTo(side * 7, 3)
          c.closePath()
          c.fill()
        }
        dot(c, 0, 0, 3.4)
        c.fillStyle = 'rgba(255, 255, 255, 0.6)'
        dot(c, -1, -1, 1.1)
        c.restore()
      }
    }
  },
  {
    id: 'popcorn',
    label: 'Bỏng ngô',
    front (c, p) {
      // Kernels thrown up from the bottom, twice a loop
      for (let i = 0; i < 10; i++) {
        const t = (p * 2 + rand(i, 2)) % 1
        const x = 60 + (rand(i, 5) - 0.5) * 30 + (rand(i, 1) - 0.5) * 90 * t
        const y = 114 - 200 * t + 190 * t * t
        c.globalAlpha = Math.min(1, t * 10, (1 - t) * 6)
        c.save()
        c.translate(x, y)
        c.rotate(PI2 * t * (i % 2 ? 1 : -1))
        c.fillStyle = '#FAEEDA'
        c.strokeStyle = '#BA7517'
        c.lineWidth = 0.5
        for (const [dx, dy] of [[-1.6, 0], [1.6, -0.4], [0, -1.8]]) {
          c.beginPath()
          c.arc(dx, dy, 2.2, 0, PI2)
          c.fill()
          c.stroke()
        }
        c.fillStyle = '#EF9F27'
        dot(c, 0.4, 1.4, 1)
        c.restore()
      }
    }
  },
  {
    id: 'steam',
    label: 'Bốc khói',
    front (c, p) {
      for (let i = 0; i < 6; i++) {
        const t = (p + i / 6) % 1
        const side = i % 2 ? 1 : -1
        c.globalAlpha = 0.75 * Math.min(1, t * 6) * (1 - t)
        c.fillStyle = '#fff'
        c.strokeStyle = '#B4B2A9'
        c.lineWidth = 0.8
        c.beginPath()
        c.arc(60 + side * (22 + t * 10) + 3 * wave(p, 2, rand(i, 3)), 26 - t * 24, 3 + t * 7, 0, PI2)
        c.fill()
        c.stroke()
      }
    }
  },
  {
    id: 'tears',
    label: 'Khóc',
    front (c, p) {
      c.fillStyle = '#85B7EB'
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1
        const t = (p * 2 + rand(i, 2)) % 1
        const x = 60 + side * (10 + t * 34)
        const y = 34 - 10 * t + 48 * t * t
        c.globalAlpha = Math.min(1, t * 10, (1 - t) * 4)
        c.beginPath()
        c.moveTo(x, y - 3.5)
        c.quadraticCurveTo(x + 2.6, y, x, y + 2.2)
        c.quadraticCurveTo(x - 2.6, y, x, y - 3.5)
        c.fill()
      }
    }
  },
  {
    id: 'cupid',
    label: 'Tim trúng tên',
    front (c, p) {
      const beat = 1 + 0.15 * Math.max(0, wave(p, 4))
      c.save()
      c.translate(94, 24)
      c.scale(beat, beat)
      c.fillStyle = '#E24B4A'
      heart(c, 0, 0, 9)
      c.restore()
      // The arrow flies in, stays through the heart, then fades
      const u = Math.min(1, p / 0.2)
      c.globalAlpha = p > 0.9 ? (1 - p) / 0.1 : 1
      c.translate(94 - 80 * (1 - u), 24 + 30 * (1 - u))
      c.rotate(-0.45)
      c.strokeStyle = '#854F0B'
      c.lineWidth = 1.6
      c.beginPath()
      c.moveTo(-16, 0)
      c.lineTo(14, 0)
      c.stroke()
      c.fillStyle = '#5F5E5A'
      c.beginPath()
      c.moveTo(18, 0)
      c.lineTo(13, -3)
      c.lineTo(13, 3)
      c.closePath()
      c.fill()
      c.fillStyle = '#ED93B1'
      for (const side of [-1, 1]) {
        c.beginPath()
        c.moveTo(-16, 0)
        c.lineTo(-20, side * 3.5)
        c.lineTo(-12, side * 3.5)
        c.lineTo(-9, 0)
        c.closePath()
        c.fill()
      }
    }
  },
  {
    id: 'stars',
    label: 'Mưa sao',
    front (c, p) {
      for (let i = 0; i < 14; i++) {
        const { x, y } = falling(i, p, 1 + (i % 2))
        const a = 0.5 + 0.5 * Math.abs(wave(p, 3, rand(i, 3)))
        c.globalAlpha = a
        c.fillStyle = ['#FAC775', '#EF9F27', '#F5C4B3'][i % 3]
        star(c, x, y, 2.5 + 3 * a * rand(i, 4) + 1.5)
      }
    }
  },
  {
    id: 'embers',
    label: 'Tàn lửa',
    front (c, p) {
      c.shadowColor = '#EF9F27'
      c.shadowBlur = 6 * c.getTransform().a
      for (let i = 0; i < 14; i++) {
        const { t, x, y } = rising(i, p)
        c.globalAlpha = Math.min(1, t * 6) * (1 - t) * (0.6 + 0.4 * Math.abs(wave(p, 4, rand(i, 5))))
        c.fillStyle = t < 0.4 ? '#FAC775' : '#D85A30'
        dot(c, x, y, 1 + rand(i, 4) * 1.4)
      }
    }
  }
]

// ---------- Light ----------

// A band of light crossing the picture: drawn on a copy of it, only where the picture is
function shine (picture, p) {
  const u = p / 0.45
  if (u >= 1) return picture
  const copy = document.createElement('canvas')
  copy.width = picture.width
  copy.height = picture.height
  const c = copy.getContext('2d')
  c.drawImage(picture, 0, 0)
  c.globalCompositeOperation = 'source-atop'
  const unit = copy.width / BOX
  c.scale(unit, unit)
  c.translate(-30 + u * (BOX + 60), BOX / 2)
  c.rotate(0.5)
  const band = c.createLinearGradient(-14, 0, 14, 0)
  band.addColorStop(0, 'rgba(255, 255, 255, 0)')
  band.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)')
  band.addColorStop(1, 'rgba(255, 255, 255, 0)')
  c.fillStyle = band
  c.fillRect(-14, -BOX * 2, 28, BOX * 4)
  return copy
}

// The picture in one flat color, keeping its outline (for the glitch)
const tints = new WeakMap()
function tinted (picture, color) {
  let byColor = tints.get(picture)
  if (!byColor) tints.set(picture, (byColor = new Map()))
  if (!byColor.has(color)) {
    const copy = document.createElement('canvas')
    copy.width = picture.width
    copy.height = picture.height
    const c = copy.getContext('2d')
    c.drawImage(picture, 0, 0)
    c.globalCompositeOperation = 'source-in'
    c.fillStyle = color
    c.fillRect(0, 0, copy.width, copy.height)
    byColor.set(color, copy)
  }
  return byColor.get(color)
}

export const LIGHTS = [
  { id: 'none', label: 'Không' },
  {
    id: 'glow',
    label: 'Phát sáng',
    subject (c, p, draw) {
      const blur = 14 + 10 * wave(p)
      draw({ glow: '#FAC775', blur })
      draw({ glow: '#FAC775', blur })
    }
  },
  {
    id: 'rainbow',
    label: 'Viền cầu vồng',
    subject (c, p, draw) {
      const color = `hsl(${Math.round(p * 360)}, 95%, 60%)`
      draw({ glow: color, blur: 20 })
      draw({ glow: color, blur: 12 })
    }
  },
  {
    id: 'shine',
    label: 'Lóe sáng quét',
    subject (c, p, draw, picture) {
      draw({ picture: shine(picture, p) })
    }
  },
  {
    id: 'halo',
    label: 'Hào quang',
    behind (c, p) {
      c.translate(60, 60)
      c.fillStyle = 'rgba(250, 199, 117, 0.18)'
      dot(c, 0, 0, 46)
      // 12 rays turn a twelfth of a circle per loop, so the loop is seamless
      c.rotate((PI2 * p) / 12)
      c.fillStyle = 'rgba(250, 199, 117, 0.32)'
      for (let k = 0; k < 12; k++) {
        c.rotate(PI2 / 12)
        c.beginPath()
        c.moveTo(0, 0)
        c.lineTo(-6, -66)
        c.lineTo(6, -66)
        c.closePath()
        c.fill()
      }
    }
  },
  {
    id: 'glitch',
    label: 'Nhiễu glitch',
    subject (c, p, draw, picture) {
      const on = (p > 0.1 && p < 0.18) || (p > 0.6 && p < 0.66) || (p > 0.7 && p < 0.73)
      if (!on) return draw()
      const jump = Math.round(p * FRAME_COUNT) % 2 ? 3 : -3
      draw({ picture: tinted(picture, '#E24B4A'), dx: -4 + jump, alpha: 0.8 })
      draw({ picture: tinted(picture, '#5DCAA5'), dx: 4, alpha: 0.8 })
      draw({ dx: jump * 0.4 })
    }
  },
  {
    id: 'fireworks',
    label: 'Pháo hoa',
    behind (c, p) {
      for (let b = 0; b < 3; b++) {
        const t = (p + b / 3) % 1
        if (t >= 0.7) continue
        const u = t / 0.7
        const spread = 1 - (1 - u) ** 3
        const cx = [24, 96, 60][b]
        const cy = [26, 30, 12][b]
        c.globalAlpha = 1 - u
        c.fillStyle = ['#F0997B', '#5DCAA5', '#FAC775'][b]
        for (let k = 0; k < 12; k++) {
          const a = (PI2 * k) / 12
          dot(c, cx + Math.cos(a) * 26 * spread, cy + Math.sin(a) * 26 * spread + u * u * 6, 1.6 * (1 - u) + 0.6)
        }
      }
    }
  },
  {
    id: 'lightning',
    label: 'Tia điện',
    subject (c, p, draw) {
      const frame = Math.round(p * FRAME_COUNT)
      if (frame % 5 >= 3) return draw()
      draw({ glow: '#B5D4F4', blur: 18 })
      c.save()
      c.strokeStyle = '#B5D4F4'
      c.shadowColor = '#85B7EB'
      c.shadowBlur = 10 * c.getTransform().a
      c.lineWidth = 1.6
      c.lineJoin = 'round'
      for (let b = 0; b < 3; b++) {
        const a = PI2 * (b / 3 + rand(frame, b))
        c.beginPath()
        c.moveTo(60 + Math.cos(a) * 40, 60 + Math.sin(a) * 40)
        for (let k = 1; k < 5; k++) {
          c.lineTo(60 + Math.cos(a) * (40 + k * 4) + (rand(frame + k, b + 3) - 0.5) * 12, 60 + Math.sin(a) * (40 + k * 4) + (rand(frame + k, b + 5) - 0.5) * 12)
        }
        c.stroke()
      }
      c.restore()
    }
  },
  {
    id: 'ripple',
    label: 'Sóng gợn',
    behind (c, p) {
      c.strokeStyle = '#5DCAA5'
      c.lineWidth = 2
      for (let b = 0; b < 3; b++) {
        const t = (p + b / 3) % 1
        c.globalAlpha = 1 - t
        c.beginPath()
        c.arc(60, 60, 30 + t * 28, 0, PI2)
        c.stroke()
      }
    }
  },
  {
    id: 'fire',
    label: 'Lửa dưới chân',
    front (c, p) {
      for (let i = 0; i < 16; i++) {
        const t = (p * 2 + rand(i, 2)) % 1
        c.globalAlpha = Math.min(1, (1 - t) * 1.5)
        c.fillStyle = t < 0.3 ? '#FAC775' : (t < 0.6 ? '#EF9F27' : '#D85A30')
        dot(c, 26 + rand(i, 1) * 68 + 3 * wave(p, 3, rand(i, 3)), 114 - t * 32, (1 - t) * 7 + 1)
      }
    }
  },
  {
    id: 'flash',
    label: 'Chớp nháy',
    subject (c, p, draw) {
      const k = Math.max(0, wave(p, 4))
      draw({ glow: '#fff', blur: 1 + 24 * k, filter: `brightness(${1 + 0.5 * k})` })
    }
  },
  {
    id: 'led',
    label: 'Đèn LED viền',
    front (c, p) {
      // Lights round the edge, chasing each other (5 steps a cycle, 50 frames a loop)
      const frame = Math.round(p * FRAME_COUNT)
      const spots = []
      for (let k = 0; k < 8; k++) {
        const t = 6 + (108 * k) / 8
        spots.push([t, 6], [114, t], [120 - t, 114], [6, 120 - t])
      }
      c.shadowBlur = 6 * c.getTransform().a
      spots.forEach(([x, y], k) => {
        const lit = (k + frame) % 5 < 2
        c.globalAlpha = lit ? 1 : 0.35
        c.fillStyle = PARTY[k % PARTY.length]
        c.shadowColor = lit ? c.fillStyle : 'transparent'
        dot(c, x, y, lit ? 2.6 : 2)
      })
    }
  },
  {
    id: 'holo',
    label: 'Ánh kim',
    subject (c, p, draw, picture) {
      draw({ picture: holo(picture, p) })
    }
  },
  {
    id: 'spotlight',
    label: 'Đèn sân khấu',
    behind (c, p) {
      for (let b = 0; b < 2; b++) {
        c.save()
        c.translate(b ? 104 : 16, -6)
        c.rotate((b ? 0.45 : -0.45) + 0.3 * wave(p, 1, b * 0.5))
        const beam = c.createLinearGradient(0, 0, 0, 130)
        beam.addColorStop(0, 'rgba(250, 238, 218, 0.75)')
        beam.addColorStop(1, 'rgba(250, 238, 218, 0)')
        c.fillStyle = beam
        c.beginPath()
        c.moveTo(-3, 0)
        c.lineTo(3, 0)
        c.lineTo(22, 130)
        c.lineTo(-22, 130)
        c.closePath()
        c.fill()
        c.restore()
      }
      c.fillStyle = 'rgba(250, 238, 218, 0.4)'
      c.beginPath()
      c.ellipse(60, 110, 34, 6, 0, 0, PI2)
      c.fill()
    }
  },
  {
    id: 'rainbowbg',
    label: 'Cầu vồng sau',
    behind (c, p) {
      const colors = ['#E24B4A', '#EF9F27', '#FAC775', '#97C459', '#5DCAA5', '#85B7EB', '#AFA9EC']
      const k = 1 + 0.03 * wave(p, 2)
      c.translate(60, 100)
      c.scale(k, k)
      c.globalAlpha = 0.75
      c.lineWidth = 5
      colors.forEach((color, i) => {
        c.strokeStyle = color
        c.beginPath()
        c.arc(0, 0, 58 - i * 5, Math.PI, PI2)
        c.stroke()
      })
    }
  },
  {
    id: 'hue',
    label: 'Đổi màu',
    subject (c, p, draw) {
      draw({ filter: `hue-rotate(${Math.round(p * 360)}deg) saturate(1.4)` })
    }
  },
  {
    id: 'invert',
    label: 'Âm bản',
    subject (c, p, draw) {
      const on = (p >= 0.2 && p < 0.26) || (p >= 0.32 && p < 0.38) || (p >= 0.7 && p < 0.76)
      draw(on ? { filter: 'invert(1)' } : {})
    }
  },
  {
    id: 'pixel',
    label: 'Vỡ điểm ảnh',
    subject (c, p, draw, picture) {
      // Breaks into bigger and bigger squares, then back
      const u = p < 0.4 ? 0 : (p < 0.6 ? (p - 0.4) / 0.2 : (p < 0.8 ? 1 - (p - 0.6) / 0.2 : 0))
      const level = Math.round(u * 3)
      draw(level ? { picture: pixelated(picture, [0, 26, 14, 8][level]) } : {})
    }
  },
  {
    id: 'trail',
    label: 'Vệt mờ',
    demo: { motion: 'hop' },
    subject (c, p, draw, picture, at) {
      for (let k = 4; k >= 1; k--) draw({ ...at(p - k * 0.03), alpha: 0.5 - k * 0.1 })
      draw()
    }
  }
]

// The picture with a band of rainbow colors moving across it, only where the picture is
function holo (picture, p) {
  const copy = document.createElement('canvas')
  const w = (copy.width = picture.width)
  copy.height = picture.height
  const c = copy.getContext('2d')
  c.drawImage(picture, 0, 0)
  c.globalCompositeOperation = 'source-atop'
  c.globalAlpha = 0.45
  // Three periods of colors, each as wide as the picture, moved one period per loop
  const x0 = -w + p * w
  const band = c.createLinearGradient(x0, 0, x0 + 3 * w, 0)
  for (let j = 0; j <= 18; j++) band.addColorStop(j / 18, `hsl(${(j % 6) * 60}, 90%, 65%)`)
  c.fillStyle = band
  c.fillRect(0, 0, w, copy.height)
  return copy
}

// The picture drawn with `blocks` squares across
const pixels = new WeakMap()
function pixelated (picture, blocks) {
  let bySize = pixels.get(picture)
  if (!bySize) pixels.set(picture, (bySize = new Map()))
  if (!bySize.has(blocks)) {
    const small = document.createElement('canvas')
    small.width = small.height = blocks
    small.getContext('2d').drawImage(picture, 0, 0, blocks, blocks)
    const copy = document.createElement('canvas')
    copy.width = picture.width
    copy.height = picture.height
    const c = copy.getContext('2d')
    c.imageSmoothingEnabled = false
    c.drawImage(small, 0, 0, copy.width, copy.height)
    bySize.set(blocks, copy)
  }
  return bySize.get(blocks)
}

// ---------- Words ----------

const WORD_FONT = '"Segoe UI", Roboto, Arial, sans-serif'
const INK = '#1F1F27'
const letters = (text) => {
  if (window.Intl && Intl.Segmenter) return [...new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
  return Array.from(text)
}

// The size that fits `text` in `width`, at most `max`
function fit (c, text, width, max) {
  c.font = `900 20px ${WORD_FONT}`
  const measured = c.measureText(text).width || 1
  return Math.max(6, Math.min(max, (20 * width) / measured))
}

// Words with a dark outline, like the stickers people make by hand
function outlined (c, text, x, y, size, fill) {
  c.font = `900 ${size}px ${WORD_FONT}`
  c.lineJoin = 'round'
  c.lineWidth = size * 0.26
  c.strokeStyle = INK
  c.strokeText(text, x, y)
  c.fillStyle = fill
  c.fillText(text, x, y)
}

// Each letter at its own place: paint(letter, i, x) with x the letter's middle
function eachLetter (c, text, size, paint) {
  c.font = `900 ${size}px ${WORD_FONT}`
  const parts = letters(text)
  const widths = parts.map((part) => c.measureText(part).width)
  let x = 60 - widths.reduce((a, b) => a + b, 0) / 2
  parts.forEach((part, i) => {
    paint(part, i, x + widths[i] / 2)
    x += widths[i]
  })
}

const WORD_Y = 104

export const TEXTS = [
  { id: 'none', label: 'Không' },
  {
    id: 'plain',
    label: 'Chữ đứng yên',
    draw (c, p, text) {
      outlined(c, text, 60, WORD_Y, fit(c, text, 104, 22), '#fff')
    }
  },
  {
    id: 'bounce',
    label: 'Chữ nảy',
    draw (c, p, text) {
      const k = Math.abs(wave(p, 2))
      c.translate(60, WORD_Y)
      c.scale(1 + 0.06 * (1 - k), 1 - 0.06 * (1 - k))
      outlined(c, text, 0, -8 * k, fit(c, text, 102, 22), '#FAC775')
    }
  },
  {
    id: 'blink',
    label: 'Chữ nhấp nháy',
    draw (c, p, text) {
      const on = wave(p, 4) > -0.2
      c.globalAlpha = on ? 1 : 0.2
      const s = on ? 1.04 : 1
      c.translate(60, WORD_Y)
      c.scale(s, s)
      outlined(c, text, 0, 0, fit(c, text, 102, 22), '#ED93B1')
    }
  },
  {
    id: 'type',
    label: 'Gõ từng chữ',
    draw (c, p, text) {
      const parts = letters(text)
      const shown = Math.min(parts.length, Math.floor((p / 0.6) * (parts.length + 1)))
      const size = fit(c, text, 102, 22)
      c.font = `900 ${size}px ${WORD_FONT}`
      const left = 60 - c.measureText(text).width / 2
      const typed = parts.slice(0, shown).join('')
      if (p > 0.88) c.globalAlpha = (1 - p) / 0.12
      c.textAlign = 'left'
      outlined(c, typed, left, WORD_Y, size, '#fff')
      // The cursor blinks after the last letter
      if (p <= 0.88 && wave(p, 6) > 0) {
        const x = left + c.measureText(typed).width + 1.5
        c.fillStyle = '#5DCAA5'
        c.fillRect(x, WORD_Y - size * 0.45, Math.max(1.5, size * 0.1), size * 0.9)
      }
    }
  },
  {
    id: 'rainbow',
    label: 'Chữ cầu vồng',
    draw (c, p, text) {
      const size = fit(c, text, 102, 22)
      eachLetter(c, text, size, (part, i, x) => {
        outlined(c, part, x, WORD_Y, size, `hsl(${Math.round(i * 40 + p * 360) % 360}, 90%, 62%)`)
      })
    }
  },
  {
    id: 'wave',
    label: 'Chữ lượn sóng',
    draw (c, p, text) {
      const size = fit(c, text, 102, 20)
      eachLetter(c, text, size, (part, i, x) => {
        outlined(c, part, x, WORD_Y - 4 * Math.sin(PI2 * p * 2 - i * 0.7), size, '#85B7EB')
      })
    }
  },
  {
    id: 'pop',
    label: 'Chữ bật to',
    draw (c, p, text) {
      let s = 1
      if (p < 0.18) s = Math.max(0.01, easeOutBack(p / 0.18))
      else if (p > 0.85) s = Math.max(0.01, 1 - (p - 0.85) / 0.15)
      else s = 1 + 0.04 * Math.sin(PI2 * ((p - 0.18) / 0.67) * 2)
      c.translate(60, WORD_Y)
      c.scale(s, s)
      outlined(c, text, 0, 0, fit(c, text, 94, 24), '#F0997B')
    }
  },
  {
    id: 'marquee',
    label: 'Chữ chạy ngang',
    draw (c, p, text) {
      const size = 18
      c.font = `900 ${size}px ${WORD_FONT}`
      const width = c.measureText(text).width
      c.fillStyle = 'rgba(31, 31, 39, 0.55)'
      c.fillRect(0, WORD_Y - size * 0.75, 120, size * 1.5)
      c.fillStyle = '#FAC775'
      c.fillText(text, 120 + width / 2 - p * (120 + width), WORD_Y)
    }
  },
  {
    id: 'bubble',
    label: 'Bong bóng thoại',
    draw (c, p, text) {
      let s = 1
      if (p < 0.12) s = Math.max(0.01, easeOutBack(p / 0.12))
      else if (p > 0.92) s = Math.max(0.01, 1 - (p - 0.92) / 0.08)
      const size = fit(c, text, 92, 13)
      c.font = `900 ${size}px ${WORD_FONT}`
      const w = Math.min(112, c.measureText(text).width + 14)
      const h = size + 10
      // From the bottom of its tail, which points at the picture
      c.translate(56, 34)
      c.scale(s, s)
      const left = Math.max(-52, Math.min(6 - w / 2, 60 - w))
      c.beginPath()
      c.moveTo(-6, 0)
      c.lineTo(2, -9)
      c.lineTo(10, -9)
      c.closePath()
      c.fillStyle = '#fff'
      c.strokeStyle = INK
      c.lineWidth = 1.4
      c.fill()
      c.stroke()
      c.beginPath()
      c.roundRect(left, -9 - h, w, h, h / 2)
      c.fill()
      c.stroke()
      // Hides the line between the tail and the bubble
      c.fillRect(-1, -10.5, 10, 3)
      c.fillStyle = INK
      c.fillText(text, left + w / 2, -9 - h / 2)
    }
  }
]

// ---------- Frames round the picture ----------

// The picture in white, keeping its outline, for the thick white border
function whiteCopy (canvas) {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const c = copy.getContext('2d')
  c.drawImage(canvas, 0, 0)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = '#fff'
  c.fillRect(0, 0, copy.width, copy.height)
  return copy
}

function heartPath (c, size) {
  const x = size / 2
  const s = size * 0.42
  const y = size * 0.46
  c.beginPath()
  c.moveTo(x, y + s * 1.05)
  c.bezierCurveTo(x - s * 1.55, y - s * 0.05, x - s * 0.8, y - s * 1.25, x, y - s * 0.5)
  c.bezierCurveTo(x + s * 0.8, y - s * 1.25, x + s * 1.55, y - s * 0.05, x, y + s * 1.05)
  c.closePath()
}

export const FRAMES = [
  { id: 'none', label: 'Không' },
  {
    id: 'rounded',
    label: 'Bo góc',
    paint (c, size, drawBox) {
      c.beginPath()
      c.roundRect(0, 0, size, size, size * 0.18)
      c.clip()
      drawBox(c, 0, 0, size)
    }
  },
  {
    id: 'circle',
    label: 'Tròn',
    paint (c, size, drawBox) {
      c.beginPath()
      c.arc(size / 2, size / 2, size / 2, 0, PI2)
      c.clip()
      drawBox(c, 0, 0, size)
    }
  },
  {
    id: 'outline',
    label: 'Viền trắng',
    paint (c, size, drawBox) {
      const w = size * 0.045
      const inner = document.createElement('canvas')
      inner.width = inner.height = Math.max(1, Math.round(size - 2 * w - 2))
      drawBox(inner.getContext('2d'), 0, 0, inner.width)
      const white = whiteCopy(inner)
      const border = document.createElement('canvas')
      border.width = border.height = size
      const b = border.getContext('2d')
      for (let k = 0; k < 16; k++) {
        const a = (PI2 * k) / 16
        b.drawImage(white, w + 1 + Math.cos(a) * w, w + 1 + Math.sin(a) * w)
      }
      c.save()
      c.shadowColor = 'rgba(0, 0, 0, 0.3)'
      c.shadowBlur = size * 0.02
      c.drawImage(border, 0, 0)
      c.restore()
      c.drawImage(inner, w + 1, w + 1)
    }
  },
  {
    id: 'polaroid',
    label: 'Ảnh polaroid',
    paint (c, size, drawBox) {
      const x = size * 0.1
      const y = size * 0.02
      c.save()
      c.shadowColor = 'rgba(0, 0, 0, 0.3)'
      c.shadowBlur = size * 0.03
      c.fillStyle = '#FBFAF7'
      c.fillRect(x, y, size * 0.8, size * 0.96)
      c.restore()
      const side = size * 0.7
      const px = x + size * 0.05
      const py = y + size * 0.05
      c.fillStyle = '#E4E1D8'
      c.fillRect(px, py, side, side)
      c.save()
      c.beginPath()
      c.rect(px, py, side, side)
      c.clip()
      drawBox(c, px, py, side)
      c.restore()
    }
  },
  {
    id: 'heart',
    label: 'Khung tim',
    paint (c, size, drawBox) {
      heartPath(c, size)
      c.fillStyle = '#FBEAF0'
      c.fill()
      c.save()
      c.clip()
      drawBox(c, size * 0.14, size * 0.12, size * 0.72)
      c.restore()
      heartPath(c, size)
      c.lineJoin = 'round'
      c.strokeStyle = '#fff'
      c.lineWidth = size * 0.05
      c.stroke()
      c.strokeStyle = '#D4537E'
      c.lineWidth = size * 0.016
      c.stroke()
    }
  },
  {
    id: 'stamp',
    label: 'Tem thư',
    paint (c, size, drawBox) {
      const m = size * 0.05
      const r = size * 0.024
      const paper = document.createElement('canvas')
      paper.width = paper.height = size
      const g = paper.getContext('2d')
      g.fillStyle = '#FBFAF7'
      g.fillRect(m, m, size - 2 * m, size - 2 * m)
      // The perforated edge: holes cut along the four sides
      g.globalCompositeOperation = 'destination-out'
      const count = Math.round((size - 2 * m) / (r * 2.8))
      for (let k = 0; k <= count; k++) {
        const t = m + ((size - 2 * m) * k) / count
        for (const [hx, hy] of [[t, m], [t, size - m], [m, t], [size - m, t]]) {
          g.beginPath()
          g.arc(hx, hy, r, 0, PI2)
          g.fill()
        }
      }
      c.save()
      c.shadowColor = 'rgba(0, 0, 0, 0.25)'
      c.shadowBlur = size * 0.02
      c.drawImage(paper, 0, 0)
      c.restore()
      const inset = size * 0.12
      const side = size - 2 * inset
      c.fillStyle = '#E1F5EE'
      c.fillRect(inset, inset, side, side)
      c.save()
      c.beginPath()
      c.rect(inset, inset, side, side)
      c.clip()
      drawBox(c, inset, inset, side)
      c.restore()
      c.strokeStyle = '#B4B2A9'
      c.lineWidth = size * 0.006
      c.strokeRect(inset, inset, side, side)
      // A postmark over the corner
      c.strokeStyle = 'rgba(60, 52, 137, 0.55)'
      c.lineWidth = size * 0.012
      c.beginPath()
      c.arc(size * 0.76, size * 0.76, size * 0.12, 0, PI2)
      c.stroke()
      for (let k = -1; k <= 1; k++) {
        c.beginPath()
        for (let i = 0; i <= 12; i++) {
          const x = size * (0.3 + (i / 12) * 0.34)
          const y = size * (0.76 + k * 0.04) + Math.sin(i * 1.3) * size * 0.012
          if (i) c.lineTo(x, y)
          else c.moveTo(x, y)
        }
        c.stroke()
      }
    }
  }
]

// ---------- Accessories put on the picture ----------

// Each accessory draws in its own space: 1 is its width, (0, 0) is where it is placed (the
// bottom middle of a hat, the middle of glasses). `spot` says where it goes by default: on top
// of the head, or on the face.

const bounceOut = (u) => {
  const n = 7.5625
  const d = 2.75
  if (u < 1 / d) return n * u * u
  if (u < 2 / d) {
    const v = u - 1.5 / d
    return n * v * v + 0.75
  }
  if (u < 2.5 / d) {
    const v = u - 2.25 / d
    return n * v * v + 0.9375
  }
  const v = u - 2.625 / d
  return n * v * v + 0.984375
}

// Shadows ignore the canvas's scale: sized by hand
const blur = (c, k) => k * c.getTransform().a

export const ACCESSORIES = [
  { id: 'none', label: 'Không' },
  {
    id: 'sunglasses',
    label: 'Kính râm',
    spot: 'face',
    draw (c, p) {
      // Falls onto the face, then stays
      const drop = p < 0.25 ? (1 - bounceOut(p / 0.25)) * -3 : 0
      if (p > 0.92) c.globalAlpha *= (1 - p) / 0.08
      c.translate(0, drop)
      c.fillStyle = '#1F1F27'
      c.beginPath()
      c.roundRect(-0.5, -0.14, 0.44, 0.3, 0.1)
      c.roundRect(0.06, -0.14, 0.44, 0.3, 0.1)
      c.fill()
      c.fillRect(-0.08, -0.12, 0.16, 0.05)
      // A glint crossing the lenses
      if (p > 0.45 && p < 0.62) {
        const x = -0.6 + ((p - 0.45) / 0.17) * 1.2
        c.save()
        c.clip()
        c.fillStyle = 'rgba(255, 255, 255, 0.75)'
        c.beginPath()
        c.moveTo(x, -0.2)
        c.lineTo(x + 0.08, -0.2)
        c.lineTo(x - 0.02, 0.2)
        c.lineTo(x - 0.1, 0.2)
        c.closePath()
        c.fill()
        c.restore()
      }
    }
  },
  {
    id: 'crown',
    label: 'Vương miện',
    spot: 'top',
    draw (c, p) {
      c.beginPath()
      c.moveTo(-0.42, 0)
      c.lineTo(-0.5, -0.55)
      c.lineTo(-0.25, -0.28)
      c.lineTo(0, -0.64)
      c.lineTo(0.25, -0.28)
      c.lineTo(0.5, -0.55)
      c.lineTo(0.42, 0)
      c.closePath()
      const gold = c.createLinearGradient(0, -0.64, 0, 0)
      gold.addColorStop(0, '#FAEEDA')
      gold.addColorStop(0.5, '#FAC775')
      gold.addColorStop(1, '#EF9F27')
      c.fillStyle = gold
      c.fill()
      c.lineWidth = 0.03
      c.lineJoin = 'round'
      c.strokeStyle = '#854F0B'
      c.stroke()
      c.fillStyle = '#E24B4A'
      dot(c, 0, -0.14, 0.06)
      c.fillStyle = '#85B7EB'
      dot(c, -0.26, -0.12, 0.045)
      dot(c, 0.26, -0.12, 0.045)
      // Sparkles on the points
      c.fillStyle = '#fff'
      ;[[-0.5, -0.55], [0, -0.64], [0.5, -0.55]].forEach(([x, y], k) => {
        const a = Math.max(0, wave(p, 2, k / 3))
        if (a > 0.1) {
          c.globalAlpha = a
          star(c, x, y, 0.06 + 0.1 * a)
        }
      })
    }
  },
  {
    id: 'partyhat',
    label: 'Mũ sinh nhật',
    spot: 'top',
    draw (c, p) {
      c.rotate(0.15 + 0.07 * wave(p, 2))
      c.beginPath()
      c.moveTo(-0.34, 0)
      c.lineTo(0, -1)
      c.lineTo(0.34, 0)
      c.closePath()
      c.fillStyle = '#85B7EB'
      c.fill()
      c.save()
      c.clip()
      c.strokeStyle = '#FAC775'
      c.lineWidth = 0.09
      for (let k = -2; k <= 3; k++) {
        c.beginPath()
        c.moveTo(-0.5, k * 0.22)
        c.lineTo(0.5, k * 0.22 - 0.4)
        c.stroke()
      }
      c.restore()
      c.fillStyle = '#ED93B1'
      dot(c, 0, -1.02 - 0.04 * Math.abs(wave(p, 4)), 0.11)
      c.fillStyle = '#5DCAA5'
      c.fillRect(-0.36, -0.06, 0.72, 0.08)
    }
  },
  {
    id: 'horns',
    label: 'Sừng quỷ',
    spot: 'top',
    draw (c, p) {
      c.shadowColor = '#E24B4A'
      c.shadowBlur = blur(c, 0.12 + 0.1 * Math.max(0, wave(p, 2)))
      for (const side of [-1, 1]) {
        const x = side * 0.3
        c.beginPath()
        c.moveTo(x - 0.11, 0)
        c.quadraticCurveTo(x - side * 0.02, -0.25, x + side * 0.12, -0.5)
        c.quadraticCurveTo(x + side * 0.06, -0.2, x + 0.11, 0)
        c.closePath()
        const red = c.createLinearGradient(0, -0.5, 0, 0)
        red.addColorStop(0, '#A32D2D')
        red.addColorStop(1, '#E24B4A')
        c.fillStyle = red
        c.fill()
      }
    }
  },
  {
    id: 'halo',
    label: 'Vòng thiên thần',
    spot: 'above',
    draw (c, p) {
      c.translate(0, -0.08 * wave(p))
      c.shadowColor = '#FAC775'
      c.shadowBlur = blur(c, 0.15)
      c.strokeStyle = '#FAC775'
      c.lineWidth = 0.08
      c.beginPath()
      c.ellipse(0, 0, 0.42, 0.11, 0, 0, PI2)
      c.stroke()
    }
  },
  {
    id: 'blush',
    label: 'Má hồng',
    spot: 'cheeks',
    draw (c, p) {
      c.fillStyle = `rgba(237, 147, 177, ${0.55 + 0.2 * wave(p, 2)})`
      for (const side of [-1, 1]) {
        c.beginPath()
        c.ellipse(side * 0.34, 0, 0.15, 0.09, 0, 0, PI2)
        c.fill()
      }
      c.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      c.lineWidth = 0.025
      c.lineCap = 'round'
      for (const side of [-1, 1]) {
        for (let k = -1; k <= 1; k++) {
          const x = side * 0.34 + k * 0.06
          c.beginPath()
          c.moveTo(x + 0.02, -0.04)
          c.lineTo(x - 0.02, 0.04)
          c.stroke()
        }
      }
    }
  },
  {
    id: 'catears',
    label: 'Tai mèo',
    spot: 'top',
    draw (c, p) {
      // The left ear twitches now and then
      const twitch = p > 0.5 && p < 0.58 ? Math.sin(((p - 0.5) / 0.08) * Math.PI) : 0
      for (const side of [-1, 1]) {
        c.save()
        c.translate(side * 0.3, 0)
        if (side < 0) c.rotate(-0.35 * twitch)
        c.beginPath()
        c.moveTo(-0.19, 0)
        c.lineTo(side * 0.07, -0.44)
        c.lineTo(0.19, 0)
        c.closePath()
        c.fillStyle = '#444441'
        c.fill()
        c.beginPath()
        c.moveTo(-0.1, -0.03)
        c.lineTo(side * 0.06, -0.3)
        c.lineTo(0.1, -0.03)
        c.closePath()
        c.fillStyle = '#ED93B1'
        c.fill()
        c.restore()
      }
    }
  },
  {
    id: 'bunny',
    label: 'Tai thỏ',
    spot: 'top',
    draw (c, p) {
      for (const side of [-1, 1]) {
        c.save()
        c.translate(side * 0.2, 0)
        c.rotate(side * (0.18 + 0.08 * wave(p, 2, side > 0 ? 0.25 : 0)))
        c.fillStyle = '#F1EFE8'
        c.strokeStyle = '#B4B2A9'
        c.lineWidth = 0.03
        c.beginPath()
        c.ellipse(0, -0.42, 0.13, 0.44, 0, 0, PI2)
        c.fill()
        c.stroke()
        c.fillStyle = '#F4C0D1'
        c.beginPath()
        c.ellipse(0, -0.42, 0.06, 0.32, 0, 0, PI2)
        c.fill()
        c.restore()
      }
    }
  },
  {
    id: 'mustache',
    label: 'Ria mép',
    spot: 'mouth',
    draw (c, p) {
      // Twirls at the start of the loop
      c.rotate(p < 0.3 ? 0.12 * Math.sin((p / 0.3) * PI2 * 2) : 0)
      c.fillStyle = '#2C2C2A'
      for (const side of [-1, 1]) {
        c.beginPath()
        c.moveTo(0, -0.04)
        c.bezierCurveTo(side * 0.15, -0.14, side * 0.36, -0.06, side * 0.44, -0.16)
        c.bezierCurveTo(side * 0.48, -0.04, side * 0.3, 0.1, 0, 0.04)
        c.closePath()
        c.fill()
      }
    }
  },
  {
    id: 'bow',
    label: 'Nơ',
    spot: 'top',
    draw (c, p) {
      const k = 1 + 0.06 * wave(p, 2)
      c.translate(0.22, -0.08)
      c.scale(k, k)
      c.fillStyle = '#ED93B1'
      c.strokeStyle = '#D4537E'
      c.lineWidth = 0.03
      c.lineJoin = 'round'
      for (const side of [-1, 1]) {
        c.beginPath()
        c.moveTo(0, 0)
        c.quadraticCurveTo(side * 0.25, -0.28, side * 0.32, -0.08)
        c.quadraticCurveTo(side * 0.34, 0.12, 0, 0)
        c.closePath()
        c.fill()
        c.stroke()
      }
      c.fillStyle = '#D4537E'
      dot(c, 0, 0, 0.065)
    }
  },
  {
    id: 'flowers',
    label: 'Vòng hoa',
    spot: 'top',
    draw (c, p) {
      const colors = ['#ED93B1', '#FAC775', '#F0997B', '#AFA9EC', '#ED93B1', '#FAC775', '#F0997B']
      c.strokeStyle = '#639922'
      c.lineWidth = 0.04
      c.beginPath()
      c.moveTo(-0.5, -0.04)
      c.quadraticCurveTo(0, -0.24, 0.5, -0.04)
      c.stroke()
      colors.forEach((color, k) => {
        const t = k / 6
        const x = -0.48 + t * 0.96
        const y = -0.04 - 0.4 * t * (1 - t) * 1.0
        c.save()
        c.translate(x, y)
        c.rotate(0.3 * wave(p, 1, k / 7))
        c.fillStyle = color
        for (let a = 0; a < 5; a++) {
          dot(c, Math.cos((PI2 * a) / 5) * 0.055, Math.sin((PI2 * a) / 5) * 0.055, 0.05)
        }
        c.fillStyle = '#FAEEDA'
        dot(c, 0, 0, 0.035)
        c.restore()
      })
    }
  }
]

// Where the head is likely to be: the middle and width of the top of what the picture shows,
// in the picture's own units (BOX wide, 0 in the middle)
export function findHead (picture) {
  const n = Math.min(64, picture.width)
  const probe = document.createElement('canvas')
  probe.width = probe.height = n
  const c = probe.getContext('2d', { willReadFrequently: true })
  c.drawImage(picture, 0, 0, n, n)
  const alpha = c.getImageData(0, 0, n, n).data
  const solid = (x, y) => alpha[(y * n + x) * 4 + 3] > 60
  let top = -1
  for (let y = 0; y < n && top < 0; y++) {
    for (let x = 0; x < n; x++) {
      if (solid(x, y)) {
        top = y
        break
      }
    }
  }
  if (top < 0) return { x: 0, y: -BOX / 4, width: BOX / 3 }
  // The widest row a little below the top: the head, not the hair's tip
  let left = n
  let right = -1
  for (let y = top; y < Math.min(n, top + Math.ceil(n * 0.12)); y++) {
    for (let x = 0; x < n; x++) {
      if (!solid(x, y)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  const unit = BOX / n
  return { x: ((left + right + 1) / 2) * unit - BOX / 2, y: top * unit - BOX / 2, width: (right - left + 1) * unit }
}

// Where an accessory goes at first, from where the head seems to be
export function defaultPlace (id, head) {
  const spot = byId(ACCESSORIES, id).spot
  const size = Math.min(48, Math.max(14, head.width * 1.05))
  const place = { x: head.x, y: head.y + size * 0.12, size }
  if (spot === 'above') place.y = head.y - size * 0.18
  if (spot === 'face') place.y = head.y + size * 0.42
  if (spot === 'cheeks') place.y = head.y + size * 0.62
  if (spot === 'mouth') place.y = head.y + size * 0.8
  return place
}

// ---------- A whole frame ----------

const byId = (list, id) => list.find((item) => item.id === id) || list[0]

export const NO_EFFECTS = { motion: 'still', particle: 'none', light: 'none', text: 'none', frame: 'none', caption: '', accessory: 'none', place: null }

const hasWords = (fx) => fx.text !== 'none' && !!(fx.caption || '').trim()

// Accessories always move a little, so a sticker with one is animated
export const isAnimated = (fx) => !!fx && (fx.motion !== 'still' || fx.particle !== 'none' || fx.light !== 'none' || (fx.accessory !== 'none' && !!fx.place) || (hasWords(fx) && fx.text !== 'plain'))

// The picture with its frame, side × side
export function framePicture (side, drawBox, frame = 'none') {
  const size = Math.max(1, Math.round(side))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const paint = byId(FRAMES, frame).paint
  if (paint) paint(canvas.getContext('2d'), size, drawBox)
  else drawBox(canvas.getContext('2d'), 0, 0, size)
  return canvas
}

// The picture as drawn in an animated sticker, once: every frame then only moves this copy
export function makePicture (side, drawBox, frame) {
  return framePicture((side * BOX) / 120, drawBox, frame)
}

function drawWords (ctx, fx, p) {
  if (!hasWords(fx)) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  byId(TEXTS, fx.text).draw(ctx, p, fx.caption.trim())
  ctx.restore()
}

// A still sticker: the picture (framed, from framePicture) filling the square, words on it
export function drawStill (ctx, side, fx, picture) {
  ctx.drawImage(picture, 0, 0, side, side)
  ctx.save()
  ctx.scale(side / 120, side / 120)
  drawWords(ctx, fx, 0)
  ctx.restore()
}

// One frame of the sticker at phase p, on a canvas of side × side
export function drawFrame (ctx, side, fx, p, picture) {
  const motion = byId(MOTIONS, fx.motion)
  const particle = byId(PARTICLES, fx.particle)
  const light = byId(LIGHTS, fx.light)
  const poseAt = (q) => (motion.pose ? motion.pose(((q % 1) + 1) % 1) : {})
  const pose = poseAt(p)
  const unit = side / 120

  // Moves the canvas to the picture as posed: its middle at (0, 0), BOX wide
  const onPicture = (o) => {
    ctx.translate(60 + (o.x || 0) + (o.dx || 0), 60 + (o.y || 0))
    // Turns and squashes from the bottom of the picture (it stands on something), or its middle
    const pivot = o.center ? 0 : BOX / 2
    ctx.translate(0, pivot)
    ctx.rotate(o.r || 0)
    const s = o.s ?? 1
    ctx.scale(s * (o.sx ?? 1), s * (o.sy ?? 1))
    ctx.translate(0, -pivot)
  }
  const draw = (extra = {}) => {
    const o = { ...pose, ...extra }
    ctx.save()
    onPicture(o)
    if (o.glow) {
      ctx.shadowColor = o.glow
      ctx.shadowBlur = o.blur * unit
    }
    if (o.filter) ctx.filter = o.filter
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha
    const image = o.picture || picture
    if (o.wave) {
      // In thin strips, each pushed sideways along a wave
      const strips = 23
      const h = image.height / strips
      for (let j = 0; j < strips; j++) {
        const shift = o.wave * Math.sin(PI2 * o.wavePhase + j * 0.5)
        ctx.drawImage(image, 0, j * h, image.width, h, -BOX / 2 + shift, -BOX / 2 + (j * BOX) / strips, BOX, BOX / strips + 0.6)
      }
    } else {
      ctx.drawImage(image, -BOX / 2, -BOX / 2, BOX, BOX)
    }
    ctx.restore()
  }
  const layer = (paint) => {
    ctx.save()
    paint(ctx, p)
    ctx.restore()
  }

  ctx.save()
  ctx.scale(unit, unit)
  if (pose.shadow) {
    layer((c) => {
      c.fillStyle = 'rgba(0, 0, 0, 0.25)'
      c.beginPath()
      c.ellipse(60 + (pose.x || 0), 112, 24 * pose.shadow, 4 * pose.shadow, 0, 0, PI2)
      c.fill()
    })
  }
  if (light.behind) layer(light.behind)
  if (light.subject) light.subject(ctx, p, draw, picture, poseAt)
  else draw()
  const accessory = fx.place && byId(ACCESSORIES, fx.accessory)
  if (accessory && accessory.draw) {
    // On the picture, moving with it
    ctx.save()
    onPicture(pose)
    if (pose.alpha !== undefined) ctx.globalAlpha *= pose.alpha
    ctx.translate(fx.place.x, fx.place.y)
    ctx.scale(fx.place.size, fx.place.size)
    accessory.draw(ctx, p)
    ctx.restore()
  }
  if (particle.front) layer(particle.front)
  if (light.front) layer(light.front)
  drawWords(ctx, fx, p)
  ctx.restore()
}
