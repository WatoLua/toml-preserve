/**
 * Two writings of the same thumbnail pipeline configuration.
 *
 * {@link BEFORE_TOML} is the file as a human writes it: comments, sections,
 * aligned `=` signs, a multiline pipeline. {@link AFTER_TOML} holds the same
 * values and nothing else, which is the shape an encoder writing values alone
 * produces: an inline array of tables, dotted keys, escaped newlines.
 *
 * Together they cover what the library has to preserve, which is why the tests
 * lean on them rather than on a handful of one-line samples.
 */

/** The configuration as a human writes and reads it. */
export const BEFORE_TOML = `# === Global Settings ===
# Timezone for cron and for timestamps in reports (default: Europe/Paris)
timezone = "Europe/Paris"

# Nightly job turning uploaded pictures into web renditions
[[profiles]]
name = "nightly-thumbnails"
enabled = true
frequency = "0 2,14 * * *"  # Cron: every day at 02:00 and 14:00
encoder = "mozjpeg"         # Uses the MozjpegEncoder
primary_key_field = "image_id"
exif_mapping = { image_id = "image_id", title = "title", author = "author", camera = "camera", album_id = "album_id" }

# === Batch parameters ===
retention = "6M"                  # How long renditions are kept (1M = 1 month, 6M = 6 months, 30d = 30 days, 1y = 1 year)
widths = ["320", "640"]           # Rendition widths, in pixels
album_ids = ["100001", "100002", "100003"]  # Albums to process
max_images_per_batch = 10000      # Images handled in a single run (default: 1000)

# === Source bucket ===
#source_bucket = "media-uploads-*"
source_bucket             = "media-uploads-raw"
source_bucket_prefix      = "media-uploads-"
source_bucket_depth       = 6

# === Target bucket ===
target_bucket = "media-thumbnails"

# === Transform pipeline ===
# Steps applied to every picture, in order, as the encoder expects them
# Uses width (pixels) and album_id as the identifier
pipeline = '''
{
  "version": 2,
  "select": {
    "all": [
      {"range": {"uploaded_at": {"gte": "now-6M"}}},
      {"terms": {"album_id": ["100001", "100002", "100003"]}},
      {"terms": {"width": ["320", "640"]}}
    ],
    "none": [{"term": {"image_id": {"value": ""}}}]
  },
  "steps": {
    "per_width": {
      "group": {
        "field": "width",
        "size": 10
      },
      "steps": {
        "total_bytes_saved": {
          "keep": {"range": {"bytes_delta": {"gt": 0}}},
          "steps": {
            "bytes": {
              "sum": {"field": "bytes_delta"}
            }
          }
        },
        "per_image": {
          "group": {
            "field": "image_id",
            "size": 10000,
            "order": {"saved>bytes": "desc"}
          },
          "steps": {
            "renditions": {
              "count": {"field": "rendition_id"}
            },
            "shrunk": {
              "keep": {"range": {"bytes_delta": {"gt": 0}}}
            },
            "saved": {
              "keep": {"range": {"bytes_delta": {"gt": 0}}},
              "steps": {
                "bytes": {
                  "sum": {"field": "bytes_delta"}
                }
              }
            },
            "pixels_dropped": {
              "keep": {"range": {"pixel_delta": {"gt": 0}}},
              "steps": {
                "pixels": {
                  "sum": {"field": "pixel_delta"}
                }
              }
            },
            "details": {
              "first_match": {
                "size": 1,
                "fields": ["camera", "title", "author", "image_id", "album_id"]
              }
            },
            "formats_seen": {
              "group": {
                "field": "output_format",
                "size": 6
              },
              "steps": {
                "encoded_at_max": {
                  "max": {
                    "field": "encoded_at"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
'''

# === JPEG quality per width ===
# IMPORTANT: this section must stay LAST in the file
# Format: "width" = quality (percent)
# A width that is not listed falls back to the default 65% quality
[profiles.quality_by_width]
"320" = 75.0  # Small: 75% quality
"640" = 75.0  # Medium: 75% quality
`;

/** The same values after an encoder has rewritten the file. */
export const AFTER_TOML = `timezone = 'Europe/Paris'
profiles = [
	{ name = 'nightly-thumbnails', enabled = true, frequency = '0 2,14 * * *', encoder = 'mozjpeg', primary_key_field = 'image_id', exif_mapping.image_id = 'image_id', exif_mapping.title = 'title', exif_mapping.author = 'author', exif_mapping.camera = 'camera', exif_mapping.album_id = 'album_id', retention = '6M', widths = [
		'320',
		'640',
	], album_ids = [
		'100001',
		'100002',
		'100003',
	], max_images_per_batch = 10000, source_bucket = 'media-uploads-raw', source_bucket_prefix = 'media-uploads-', source_bucket_depth = 6, target_bucket = 'media-thumbnails', pipeline = "{\\n  \\"version\\": 2,\\n  \\"select\\": {\\n    \\"all\\": [\\n      {\\"range\\": {\\"uploaded_at\\": {\\"gte\\": \\"now-6M\\"}}},\\n      {\\"terms\\": {\\"album_id\\": [\\"100001\\", \\"100002\\", \\"100003\\"]}},\\n      {\\"terms\\": {\\"width\\": [\\"320\\", \\"640\\"]}}\\n    ],\\n    \\"none\\": [{\\"term\\": {\\"image_id\\": {\\"value\\": \\"\\"}}}]\\n  },\\n  \\"steps\\": {\\n    \\"per_width\\": {\\n      \\"group\\": {\\n        \\"field\\": \\"width\\",\\n        \\"size\\": 10\\n      },\\n      \\"steps\\": {\\n        \\"total_bytes_saved\\": {\\n          \\"keep\\": {\\"range\\": {\\"bytes_delta\\": {\\"gt\\": 0}}},\\n          \\"steps\\": {\\n            \\"bytes\\": {\\n              \\"sum\\": {\\"field\\": \\"bytes_delta\\"}\\n            }\\n          }\\n        },\\n        \\"per_image\\": {\\n          \\"group\\": {\\n            \\"field\\": \\"image_id\\",\\n            \\"size\\": 10000,\\n            \\"order\\": {\\"saved>bytes\\": \\"desc\\"}\\n          },\\n          \\"steps\\": {\\n            \\"renditions\\": {\\n              \\"count\\": {\\"field\\": \\"rendition_id\\"}\\n            },\\n            \\"shrunk\\": {\\n              \\"keep\\": {\\"range\\": {\\"bytes_delta\\": {\\"gt\\": 0}}}\\n            },\\n            \\"saved\\": {\\n              \\"keep\\": {\\"range\\": {\\"bytes_delta\\": {\\"gt\\": 0}}},\\n              \\"steps\\": {\\n                \\"bytes\\": {\\n                  \\"sum\\": {\\"field\\": \\"bytes_delta\\"}\\n                }\\n              }\\n            },\\n            \\"pixels_dropped\\": {\\n              \\"keep\\": {\\"range\\": {\\"pixel_delta\\": {\\"gt\\": 0}}},\\n              \\"steps\\": {\\n                \\"pixels\\": {\\n                  \\"sum\\": {\\"field\\": \\"pixel_delta\\"}\\n                }\\n              }\\n            },\\n            \\"details\\": {\\n              \\"first_match\\": {\\n                \\"size\\": 1,\\n                \\"fields\\": [\\"camera\\", \\"title\\", \\"author\\", \\"image_id\\", \\"album_id\\"]\\n              }\\n            },\\n            \\"formats_seen\\": {\\n              \\"group\\": {\\n                \\"field\\": \\"output_format\\",\\n                \\"size\\": 6\\n              },\\n              \\"steps\\": {\\n                \\"encoded_at_max\\": {\\n                  \\"max\\": {\\n                    \\"field\\": \\"encoded_at\\"\\n                  }\\n                }\\n              }\\n            }\\n          }\\n        }\\n      }\\n    }\\n  }\\n}\\n", quality_by_width.320 = 75.0, quality_by_width.640 = 75.0 },
]
`;
