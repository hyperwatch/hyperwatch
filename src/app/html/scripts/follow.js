// Keeps a log stream scrolled to the bottom, unless scrolled up
(() => {
  let follow = true;
  addEventListener('scroll', () => {
    follow =
      innerHeight + scrollY >= document.documentElement.scrollHeight - 20;
  });
  new MutationObserver(() => {
    if (follow) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
