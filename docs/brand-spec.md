# LAWCHERS interface specification

## Product boundary

LAWCHERS is a local-first case-material redaction workspace. It is not a law-firm
management dashboard and does not display lawyer identity, firm, licence,
compensation calculations, or legal-opinion generation controls.

## Design direction

- Anchor: Pentagram / Tufte information architecture
- Viewing context: 13–16 inch desktop displays used for sustained document review
- Temperature: quiet, authoritative, warm, and non-nostalgic
- Density: compact application chrome with a document-first canvas

## Warm Paper palette（仿 openhanako，2026-06-24 取代 Solarized Light）

更浅、更通透的暖白纸感；安静、温暖、不怀旧。

- Canvas: `#f7f4ee`
- Secondary surface / panel: `#f1ede4`
- Card / primary surface: `#fbfaf6`
- Primary text: `#3f4a4d`
- Secondary text: `#7a8488`
- Primary action: `#4a6b8a`（钢蓝）
- Redaction/source marker: `#2a8c8c`
- Confirmed: `#859900`
- Review required: `#b58900`
- Warning: `#cb4b16`
- Blocking error: `#dc322f`
- AI draft (reserved): `#6c71c4`
- Hairline border: `rgba(63, 74, 77, 0.13)`

> 实现说明：CSS 变量仍沿用 Solarized 命名（`--base3`/`--base2`/`--blue`/`--cyan` 等）以兼容现有组件，仅重映射取值；见 `frontend/src/index.css`。

## Typography and geometry

- Display: local Chinese serif stack (`Songti SC`, `STSong`)
- UI: local Chinese sans stack (`PingFang SC`, `Microsoft YaHei`)
- Metadata: local monospace stack (`SFMono-Regular`, `Menlo`)
- Spacing unit: 4px; common steps 8 / 12 / 16 / 24 / 32
- Radius: 2 / 4 / 8px; pills only for compact statuses
- Elevation: hairline borders by default; one restrained modal shadow
- Motion: 120–180ms; respect `prefers-reduced-motion`

## Interaction rules

- Original files are immutable.
- The default document mode is redacted preview.
- All entity categories share one visual redaction treatment; categories remain
  available only to the detection and audit layers.
- Export always creates a derivative in the original file format and runs a
  residual sensitive-data audit before the file is released.
- No emoji icons, decorative gradients, lawyer identity, or duplicate titles.
