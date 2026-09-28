// Keeps a log stream scrolled to the bottom once scrolled there, until
// scrolled up again. The page doesn't move on its own when it opens. While
// the latest logs are below the screen, a ↓ button jumps to them.
(() => {
  let follow = false;
  // Where the page was last scrolled to the bottom, while following
  let followedY = 0;
  const atBottom = () =>
    innerHeight + scrollY >= document.documentElement.scrollHeight - 20;
  const toBottom = () => {
    scrollTo(0, document.documentElement.scrollHeight);
    followedY = scrollY;
  };

  const latest = document.createElement('button');
  latest.className = 'latest';
  latest.title = 'Jump to the latest logs';
  latest.textContent = '↓';
  latest.hidden = true;
  latest.addEventListener('click', () => {
    follow = true;
    toBottom();
  });
  const update = () => {
    latest.hidden = atBottom();
  };

  addEventListener('scroll', () => {
    follow = atBottom();
    if (follow) {
      followedY = scrollY;
    }
    update();
  });
  // Scrolling up stops following at once, before new logs pull the page
  // back down (scroll events only come with the next frame)
  addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY < 0) {
        follow = false;
      }
    },
    { passive: true }
  );
  new MutationObserver(() => {
    if (follow && scrollY < followedY - 20) {
      follow = false;
    }
    if (follow) {
      toBottom();
    }
    update();
  }).observe(document.body, { childList: true, subtree: true });
  document.body.append(latest);
})();
