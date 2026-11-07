/** Original raster artwork, cropped only at presentation time. */
export function totem(el, value = 3, className = '') {
  const number = Number.isInteger(value) && value >= 1 && value <= 5 ? value : 3;
  return el('span', { class: 'art-shell ' + className, 'aria-hidden': 'true' },
    el('span', { class: 'clay clay-' + number }, el('img', { src: '/play/assets/totem-' + number + '.png', alt: '', width: 1254, height: 1254, decoding: 'async' })));
}
export function celebration(el) {
  return el('div', { class: 'quiz-celebration', 'aria-hidden': 'true' },
    el('img', { src: '/play/assets/story-cast-celebrate.png', alt: '', width: 1983, height: 793, decoding: 'async' }));
}
export function waitingCast(el) {
  return el('div', { class: 'quiz-cast-hold', 'aria-hidden': 'true' },
    el('img', { src: '/play/assets/story-cast-hold.png', alt: '', width: 1983, height: 793, decoding: 'async' }));
}
