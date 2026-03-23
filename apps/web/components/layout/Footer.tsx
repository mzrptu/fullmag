export function Footer() {
  return (
    <footer className="app-footer">
      <span>
        Fullmag &middot; Physics-first micromagnetics platform
      </span>
      <span>
        <a
          href="https://github.com/MateuszZelent/fullmag"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        {' · '}
        <a href="/docs/physics">Physics Docs</a>
      </span>
    </footer>
  );
}
