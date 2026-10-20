-- A person's profile picture is a short reference, never image bytes:
--   dicebear:<style>:<seed>   a generated avatar the browser fetches from the generator
--   upload:<hash>             a picture stored in object storage and served by the API
-- NULL means none was chosen, and the Console shows initials.
ALTER TABLE users ADD COLUMN avatar VARCHAR(120)
  CHECK (avatar IS NULL OR char_length(avatar) BETWEEN 1 AND 120);
