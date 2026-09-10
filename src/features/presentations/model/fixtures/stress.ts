/**
 * P05 stress fixture: deliberately difficult Vietnamese/English text used to
 * verify the chosen fonts and the export adapters. Kept separate from the tiny
 * P02 fixture so everyday tests stay fast.
 */

import {
  PRESENTATION_KIND,
  PRESENTATION_PAGE_HEIGHT,
  PRESENTATION_PAGE_WIDTH,
  PRESENTATION_SCHEMA_VERSION,
  type PresentationDocument,
  type TextParagraph,
} from '../types'
import { FIXTURE_FONTS } from './fixture'

const LONG_TITLE =
  'Đánh giá tác động của biến đổi khí hậu đến sản xuất nông nghiệp và sinh kế của người dân đồng bằng sông Cửu Long'

const BULLETS: TextParagraph[] = [
  ['Câu hỏi nghiên cứu', 'Biến đổi khí hậu ảnh hưởng như thế nào đến năng suất lúa và thu nhập của hộ nông dân?', 0, 'bullet'],
  ['Phương pháp', 'Kết hợp dữ liệu vệ tinh, phỏng vấn 1.200 hộ và mô hình kinh tế lượng đa cấp.', 1, 'bullet'],
  ['Kết quả chính', 'Năng suất giảm 12% ở vùng nhiễm mặn; hộ nghèo chịu tổn thất nặng nhất.', 0, 'number'],
  ['Hạn chế', 'Dữ liệu chỉ bao phủ ba tỉnh và chưa tính chi phí thích ứng dài hạn.', 0, 'number'],
  ['Khuyến nghị', 'Ưu tiên giống chịu mặn, lịch thời vụ linh hoạt và bảo hiểm nông nghiệp.', 0, 'bullet'],
].map(([lead, body, level, bullet]) => ({
  runs: [
    { text: `${lead as string}: `, fontId: FIXTURE_FONTS.body, size: 26, color: '#08152f', bold: true },
    { text: body as string, fontId: FIXTURE_FONTS.body, size: 26, color: '#08152f' },
  ],
  alignment: 'left' as const,
  bullet: bullet as TextParagraph['bullet'],
  bulletLevel: level as TextParagraph['bulletLevel'],
}))

export function createStressPresentation(): PresentationDocument {
  return {
    kind: PRESENTATION_KIND,
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    id: 'fixture-stress',
    title: 'Bài kiểm tra phông chữ và xuất tệp',
    revision: 1,
    pageSize: { width: PRESENTATION_PAGE_WIDTH, height: PRESENTATION_PAGE_HEIGHT },
    theme: {
      headingFontId: FIXTURE_FONTS.heading,
      bodyFontId: FIXTURE_FONTS.body,
      colors: { text: '#08152f', accent: '#08b879', background: '#ffffff' },
    },
    slides: [
      {
        id: 'stress-slide-title',
        name: 'Long Vietnamese title',
        background: '#ffffff',
        elements: [
          {
            id: 'stress-title',
            kind: 'text',
            name: 'Long title',
            x: 80,
            y: 120,
            width: 700,
            height: 360,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            padding: 0,
            lineHeight: 1.15,
            verticalAlign: 'top',
            paragraphs: [
              {
                runs: [{ text: LONG_TITLE, fontId: FIXTURE_FONTS.heading, size: 48, color: '#0b1f3b', bold: true }],
                alignment: 'left',
                bullet: 'none',
                bulletLevel: 0,
              },
              {
                runs: [
                  { text: 'Từ khóa: ', fontId: FIXTURE_FONTS.body, size: 24, color: '#08b879', bold: true },
                  {
                    text: 'khí hậu, nông nghiệp, sinh kế, Đồng bằng sông Cửu Long, thích ứng',
                    fontId: FIXTURE_FONTS.body,
                    size: 24,
                    color: '#08152f',
                    italic: true,
                  },
                ],
                alignment: 'left',
                bullet: 'none',
                bulletLevel: 0,
              },
            ],
          },
        ],
      },
      {
        id: 'stress-slide-bullets',
        name: 'Dense bullets',
        background: '#ffffff',
        elements: [
          {
            id: 'stress-bullets',
            kind: 'text',
            name: 'Research summary',
            x: 80,
            y: 64,
            width: 1120,
            height: 600,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            padding: 8,
            lineHeight: 1.3,
            verticalAlign: 'top',
            paragraphs: BULLETS,
          },
        ],
      },
    ],
    assets: [],
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  }
}
