# Keep presentations separate from sticker documents

Accepted for the planned presentation feature; not yet implemented. Presentations use a distinct versioned document and repository because ordered rectangular slides and rich text differ materially from the existing square transparent sticker contract. Reuse independent UI, media and persistence helpers while preserving sticker validation and saved data; this avoids forcing incompatible geometry/export semantics into existing documents at the cost of a second feature-specific model.

See [architecture](../slides-architecture.md) and [implementation plan](../slides-implementation-plan.md).
