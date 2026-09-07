# Usage

## Built with
- Pure HTML, CSS, vanilla JavaScript
- Hono backend for server routes
- Cloudflare Workers deployment

## Restrictions
- No bundler, no transpilation
- Use native browser APIs only
- ES modules for script organization

## Styling
- Pure CSS in public/styles.css
- No preprocessors (can add if needed)
- Use TailwindCSS via CDN for theming

## Structure
- public/ - Static files (HTML, CSS, JS)
- worker/ - Hono backend routes

## Example
```html
<!-- public/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <button id="counter">Count: 0</button>
  <script src="/app.js" type="module"></script>
</body>
</html>
```

```javascript
// public/app.js
let count = 0;
const button = document.getElementById('counter');

button.addEventListener('click', () => {
  count++;
  button.textContent = `Count: ${count}`;
});
```

```css
/* public/styles.css */
button {
  padding: 0.5rem 1rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
}
```

## Backend
- Add routes in `worker/index.ts`
- Serve static files from public/
- Use Hono for API endpoints
