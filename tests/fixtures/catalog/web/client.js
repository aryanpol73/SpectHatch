const book = await fetch('/v2/book').then((r) => r.json());
document.querySelector('h1').textContent = book.title;
