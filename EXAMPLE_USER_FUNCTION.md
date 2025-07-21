# Example: Scheduled RSS Feed Fetcher

This example shows how to create a user function that fetches RSS feeds every 10 minutes using the new Basebase user function system.

## Creating the Function

```bash
curl -X POST http://localhost:8000/v1/functions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "refetchStaleRssFeeds",
    "description": "Fetches RSS feeds for stale news sources every 10 minutes",
    "implementationCode": "async (params, context) => { const { console, data, functions } = context; console.log(\"Starting RSS feed refresh...\"); const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); const sources = await data.collection(\"news_sources\").queryDocs({ where: [{ field: \"lastUpdated\", operator: \"<\", value: staleThreshold }], limit: 10 }); console.log(`Found ${sources.length} stale sources`); let processed = 0; for (const source of sources) { try { const response = await functions.call(\"getPage\", { url: source.rssUrl }); if (response.success) { const stories = parseSimpleRss(response.data); for (const story of stories) { await data.collection(\"news_stories\").addDoc({ title: story.title, content: story.content, url: story.url, sourceId: source.id, publishedAt: new Date(story.pubDate || Date.now()), createdAt: new Date() }); } await data.collection(\"news_sources\").updateDoc(source.id, { lastUpdated: new Date(), storiesCount: (source.storiesCount || 0) + stories.length }); console.log(`Updated ${stories.length} stories from ${source.name}`); processed++; } } catch (error) { console.error(`Failed to update source ${source.name}:`, error.message); } } return { processed, total: sources.length }; function parseSimpleRss(xmlString) { const items = []; const regex = /<item[^>]*>(.*?)<\/item>/gs; let match; while ((match = regex.exec(xmlString)) !== null) { const itemXml = match[1]; const title = extractTag(itemXml, \"title\"); const link = extractTag(itemXml, \"link\"); const description = extractTag(itemXml, \"description\"); const pubDate = extractTag(itemXml, \"pubDate\"); if (title && link) { items.push({ title: title.replace(/<!\[CDATA\[(.*?)\]\]>/g, \"$1\").trim(), url: link.trim(), content: description ? description.replace(/<!\[CDATA\[(.*?)\]\]>/g, \"$1\").replace(/<[^>]*>/g, \"\").trim() : \"\", pubDate: pubDate }); } } return items; } function extractTag(xml, tagName) { const regex = new RegExp(`<${tagName}[^>]*>(.*?)<\/${tagName}>`, \"s\"); const match = xml.match(regex); return match ? match[1] : null; } }",
    "requiredServices": [],
    "schedule": "*/10 * * * *",
    "enabled": true
  }'
```

## Response

```json
{
  "id": "refetchStaleRssFeeds",
  "description": "Fetches RSS feeds for stale news sources every 10 minutes",
  "requiredServices": [],
  "schedule": "*/10 * * * *",
  "enabled": true,
  "isUserFunction": true,
  "createdBy": "user_abc123",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## What the Function Does

1. **Queries Database**: Uses `data.collection("news_sources").queryDocs()` to find news sources that haven't been updated in 10+ minutes
2. **Calls Basebase Function**: Uses `functions.call("getPage", { url: source.rssUrl })` to fetch the RSS feed
3. **Parses RSS**: Simple RSS parser extracts title, link, description, and publish date
4. **Stores Stories**: Uses `data.collection("news_stories").addDoc()` to save new stories
5. **Updates Source**: Uses `data.collection("news_sources").updateDoc()` to update the lastUpdated timestamp

## Scheduling

The function is scheduled with `"*/10 * * * *"` which means it runs every 10 minutes automatically.

## Manual Execution

You can also run the function manually:

```bash
curl -X POST http://localhost:8000/v1/projects/newswithfriends/functions/refetchStaleRssFeeds:call \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {}}'
```

## Available APIs in Functions

### Data API (Firebase-style)

- `data.collection(name).getDoc(id)` - Get single document
- `data.collection(name).getDocs()` - Get all documents
- `data.collection(name).addDoc(data)` - Add document with auto-generated ID
- `data.collection(name).setDoc(id, data)` - Set document with specific ID
- `data.collection(name).updateDoc(id, data)` - Update document
- `data.collection(name).deleteDoc(id)` - Delete document
- `data.collection(name).queryDocs(filter)` - Query with where/orderBy/limit

### Function API

- `functions.call(functionName, data)` - Call other functions (basebase or user functions)

### Console API

- `console.log()`, `console.error()`, `console.warn()` - Logging

## Supported Schedule Formats

- `"*/10 * * * *"` - Every 10 minutes
- `"0 */1 * * *"` - Every hour
- `"0 9 * * *"` - Daily at 9 AM

## Sample Data Setup

First, create some news sources:

```bash
# Create a news source
curl -X POST http://localhost:8000/v1/projects/newswithfriends/databases/\(default\)/documents/news_sources \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "name": {"stringValue": "TechCrunch"},
      "rssUrl": {"stringValue": "https://techcrunch.com/feed/"},
      "lastUpdated": {"stringValue": "2024-01-01T00:00:00.000Z"},
      "storiesCount": {"integerValue": "0"}
    }
  }'
```

Then the scheduled function will automatically fetch and parse RSS feeds!
