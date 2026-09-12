# Presentation sticker generation prompts

Generated with the built-in image generation tool on 2026-09-12. Each subject was generated as a separate asset so it can be placed, scaled, and rotated independently in a presentation template.

## Shared prompt

```text
Use case: stylized-concept (for objects) or illustration-story (for characters)
Asset type: reusable transparent PNG [SUBJECT] sticker for university presentation templates
Style/medium: original cheerful hand-drawn editorial sticker [SUBJECT], bold dark navy ink outline, thick irregular white die-cut border, subtle paper grain, crisp clean edges, playful but polished
Color palette: StickerLab mint and emerald, warm cream, sunny yellow, blush pink, lavender, sky blue, dark navy
Composition/framing: one isolated centered object/character or tightly unified cluster, strong silhouette, generous transparent padding, no cropped edges
Scene/backdrop: genuinely transparent background with clean alpha; no colored rectangle or scene
Lighting/mood: bright, smart, friendly, energetic
Constraints: exactly one main subject; no words, letters, numbers, logos, UI, watermark, extra characters; preserve genuine transparency
Avoid: photorealism, 3D, thin outline, gray/black background, drop shadow to edges
```

For object stickers, `[SUBJECT]` used the stylized-concept use case. Mascots and the student group used illustration-story.

## Generated set

| File | Subject | Suggested presentation use |
| --- | --- | --- |
| `achievement-trophy.png` | A cheerful gold achievement trophy with a small star emblem and sparkles | Closing, results, celebration |
| `cat-presenter.png` | A friendly orange tabby presenter holding a pointer, wearing a mint cardigan and lavender bow tie | Classroom guide, section opener |
| `corgi-student.png` | A cheerful corgi student waving beside a tiny mint laptop, wearing a lavender bandana | Student project, friendly callout |
| `creative-laptop.png` | An open mint laptop displaying abstract pastel design shapes | Digital work, creative process |
| `goal-target.png` | A coral bullseye target with an arrow in the center | Goals, objectives, strategy |
| `graduation-cap.png` | A mint graduation cap with a golden tassel and small accent marks | Education, conclusion, graduation |
| `growth-chart.png` | A three-bar pastel growth chart with a sweeping navy arrow | Findings, progress, impact |
| `idea-lightbulb.png` | A glowing yellow lightbulb containing a small green sprout | Idea, insight, sustainability |
| `instant-camera.png` | A coral instant camera with a blank cream photo emerging | Portfolio, memories, field work |
| `launch-rocket.png` | A mint-and-cream rocket launching with a lavender smoke puff | Launch, ambition, next steps |
| `megaphone.png` | A mint megaphone with a coral bell and small yellow sound marks | Announcement, key message, club pitch |
| `microscope.png` | A mint and lavender laboratory microscope | Research methods, science |
| `owl-researcher.png` | A wise brown owl researcher with round glasses and a magnifying glass, perched on a book | Evidence, review, references |
| `paper-plane.png` | A cream paper plane with a mint-and-lavender swoosh trail | Journey, communication, transition |
| `project-calendar.png` | A mint desk calendar with a blank grid and a large yellow check mark | Timeline, planning, deadline |
| `project-clock.png` | A round mint clock with a cream face | Timing, agenda, schedule |
| `puzzle-team.png` | Three interlocking mint, yellow, and lavender puzzle pieces | Collaboration, systems, fit |
| `research-review.png` | A small stack of cream research papers with a blue magnifying glass | Literature review, evidence, audit |
| `science-flask.png` | A laboratory flask containing bubbly green liquid and tiny pink molecule accents | Experiment, methods, discovery |
| `speech-bubbles.png` | Two overlapping blank speech bubbles in mint and blush pink | Discussion, quote, Q&A |
| `student-team.png` | Three diverse university students celebrating together in mint, lavender, and yellow outfits | Team introduction, community, success |
| `study-books.png` | A stack of mint, lavender, and coral books with a bookmark | Sources, learning, chapter divider |
| `teamwork-hands.png` | Four diverse hands meeting in the center with colorful sleeves | Teamwork, partnership, inclusion |
| `world-globe.png` | A cheerful blue and green tabletop globe with small sparkles | Global context, geography, reach |

The production files live in `public/art/presentation-stickers/`. They were trimmed, constrained to a maximum 1024×1024 canvas without upscaling, stripped of metadata, and losslessly compressed. Alpha-channel validation confirmed that every file contains transparent pixels.
