// Keeps a log stream scrolled to the bottom once scrolled there, until
// scrolled up again. The page doesn't move on its own when it opens.
(() => {
  let follow = false;
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
