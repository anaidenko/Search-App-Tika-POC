## Prerequisites

1. ElasticSearch server
2. Tika
3. LibreOffice (soffice cli)
4. JRE 6

## ES config

```
PUT tika-file
{
   "settings": {
      "index": {
        "highlight": {
          "max_analyzed_offset": 1000000000
        },
         "analysis": {
            "char_filter": {
               "my_html": {
                  "type": "html_strip"
               }
            },
            "analyzer": {
               "my_html": {
                  "tokenizer": "standard",
                  "char_filter": [
                     "my_html"
                  ],
                  "type": "custom"
               }
            }
         }
      }
   }
}
```

```
PUT tika-file/file/_mapping
{
   "properties": {
     "timestamp": {
       "type": "date"
     },
      "username": {
        "type": "keyword"
      },
      "folder": {
        "type": "keyword"
      },
      "filename": {
        "type": "keyword"
      },
      "attachment": {
        "type": "object",
        "properties": {
          "date": {
            "type": "date"
          },
          "title": {
            "type": "keyword"
          },
          "keywords": {
            "type": "keyword"
          },
          "content_length": {
            "type": "long"
          },
          "content_type": {
            "type": "keyword"
          },
          "content": {
            "type": "text",
            "analyzer": "my_html",
            "search_analyzer": "standard"
          },
          "pages": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer"
              },
              "content": {
                "type": "text",
                "analyzer": "my_html",
                "search_analyzer": "standard"
              },
              "paragraphs": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "integer"
                  },
                  "content": {
                    "type": "text",
                    "analyzer": "my_html",
                    "search_analyzer": "standard"
                  },
                  "sentences": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "long"
                      },
                      "content": {
                        "type": "text",
                        "analyzer": "my_html",
                        "search_analyzer": "standard"
                      }
                    }
                  }
                }
              }
            }
          },
          "tables": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer"
              },
              "content": {
                "type": "text",
                "analyzer": "my_html",
                "search_analyzer": "standard"
              }
            }
          }
        }
      }
   }
}
```

## Query Samples

These queries can be run via ES / Kibana UI / Dev Tools.

### by documents

```
GET tika-file/_search
{
  "query": {
    "match": {
      "attachment.content": "bank"
    }
  },
  "_source": {
    "excludes": ["attachment.content", "attachment.tables", "attachment.pages"]
  },
  "highlight": {
    "tags_schema": "styled",
    "fields": {
      "attachment.content": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"],
        "fragment_size": 1000000000,
        "number_of_fragments": 50,
        "order": "score"
      }
    }
  }
}
```

### by pages

```
GET tika-file/_search
{
  "query": {
    "match": {
      "attachment.pages.content": "bank"
    }
  },
  "_source": {
    "excludes": ["attachment.content", "attachment.tables", "attachment.pages"]
  },
  "highlight": {
    "tags_schema": "styled",
    "fields": {
      "attachment.pages.content": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"],
        "fragment_size": 1000000000,
        "number_of_fragments": 50,
        "order": "score"
      }
    }
  }
}
```

### by paragraphs

```
GET tika-file/_search
{
  "query": {
    "match": {
      "attachment.pages.paragraphs.content": "bank"
    }
  },
  "_source": {
    "excludes": ["attachment.content", "attachment.tables", "attachment.pages"]
  },
  "highlight": {
    "tags_schema": "styled",
    "fields": {
      "attachment.pages.paragraphs.content": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"],
        "fragment_size": 1000000000,
        "number_of_fragments": 50,
        "order": "score"
      }
    }
  }
}
```

### by sentences

```
GET tika-file/_search
{
  "query": {
    "match": {
      "attachment.pages.paragraphs.sentences.content": "bank"
    }
  },
  "_source": {
    "excludes": ["attachment.content", "attachment.tables", "attachment.pages"]
  },
  "highlight": {
    "tags_schema": "styled",
    "fields": {
      "attachment.pages.paragraphs.sentences.content": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"],
        "fragment_size": 1000000000,
        "number_of_fragments": 50,
        "order": "score"
      }
    }
  }
}
```

### by tables

```
GET tika-file/_search
{
  "query": {
    "match": {
      "attachment.tables.content": "drops of water"
    }
  },
  "_source": {
    "excludes": ["attachment.content", "attachment.tables", "attachment.pages"]
  },
  "highlight": {
    "tags_schema": "styled",
    "fields": {
      "attachment.tables.content": {
        "pre_tags": ["<em>"],
        "post_tags": ["</em>"],
        "fragment_size": 1000000000,
        "number_of_fragments": 50,
        "order": "score"
      }
    }
  }
}
```
