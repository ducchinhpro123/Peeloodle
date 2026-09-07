import type { TextStyle } from './store'
import { ILLUSTRATIONS } from '../assets/illustrations'

export const TEXT_PRESETS = [
  { content: 'Hello, cutie!', fontFamily: 'Fredoka', fontSize: 80, color: '#00875e', description: 'Cute & rounded' },
  { content: 'PAWSOME!', fontFamily: 'Baloo 2', fontSize: 88, color: '#7c3aed', description: 'Playful & chunky' },
  { content: 'WOW!', fontFamily: 'Luckiest Guy', fontSize: 104, color: '#db2777', description: 'Bold comic labels' },
  { content: 'Best buddy', fontFamily: 'Chewy', fontSize: 80, color: '#c65b12', description: 'Hand-drawn character' },
  { content: 'Good Vibes!', fontFamily: 'Pacifico', fontSize: 72, color: '#db2777', description: 'Flowing script' },
  { content: 'STAY COOL', fontFamily: 'Bangers', fontSize: 96, color: '#087ca7', description: 'Big meme energy' },
] satisfies Array<TextStyle & { description: string }>

export const STICKER_CATALOG = [...ILLUSTRATIONS, ...([
  ['01-orange-cat-meow', 'Meow cat'],
  ['02-cat-stay-cool', 'Cool cat'],
  ['03-white-cat-good-vibes', 'Good vibes cat'],
  ['04-winking-smiley', 'Winking smiley'],
  ['05-mint-sparkle-top', 'Mint sparkle'],
  ['06-sunglasses', 'Sunglasses'],
  ['07-yellow-sparkle', 'Yellow sparkle'],
  ['08-mint-sparkle-right', 'Little mint sparkle'],
  ['09-pink-heart-right', 'Pink heart'],
  ['10-sleeping-cat', 'Sleepy cat'],
  ['11-paw-print', 'Paw print'],
  ['12-small-pink-heart', 'Little heart'],
  ['13-love-cats', 'Love cats bubble'],
  ['14-large-pink-heart', 'Big heart'],
  ['15-pawsome', 'Pawsome lettering'],
  ['16-rainbow', 'Rainbow'],
  ['17-yellow-star', 'Yellow star'],
  ['18-good-vibes-lettering', 'Good vibes lettering'],
  ['19-you-got-this', 'You got this bubble'],
  ['20-shooting-star', 'Shooting star'],
  ['21-smiling-heart', 'Smiling heart'],
  ['22-green-sprout', 'Green sprout'],
  ['23-twinkles', 'Twinkles'],
  ['24-blue-fish', 'Blue fish'],
  ['25-purple-heart', 'Purple heart'],
] satisfies Array<[string, string]>).map(([file, name]) => ({ name, src: `/art/stickers/${file}.webp` }))]
