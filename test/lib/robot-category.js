const assert = require('assert');

const { lookup } = require('../../src/lib/robot-category');

describe('robot category', () => {
  const categories = {
    Pingdom: 'monitoring',
    Ahrefs: { AhrefsBot: 'seo', YepBot: 'search-engine' },
  };

  it('gives the category of an identity whatever the family', () => {
    assert.strictEqual(
      lookup(categories, 'Pingdom', 'PingdomBot'),
      'monitoring'
    );
    assert.strictEqual(lookup(categories, 'Pingdom', 'Chrome'), 'monitoring');
    assert.strictEqual(lookup(categories, 'Pingdom', null), 'monitoring');
    assert.strictEqual(lookup(categories, 'Pingdom', undefined), 'monitoring');
  });

  it('gives the category of the family under an identity of several', () => {
    assert.strictEqual(lookup(categories, 'Ahrefs', 'AhrefsBot'), 'seo');
    assert.strictEqual(lookup(categories, 'Ahrefs', 'YepBot'), 'search-engine');
  });

  it('gives nothing for a family the identity does not list', () => {
    assert.strictEqual(lookup(categories, 'Ahrefs', 'PingdomBot'), undefined);
    assert.strictEqual(lookup(categories, 'Ahrefs', null), undefined);
    assert.strictEqual(lookup(categories, 'Ahrefs', undefined), undefined);
  });

  it('gives nothing for an unknown identity', () => {
    assert.strictEqual(lookup(categories, 'Nobody', 'AhrefsBot'), undefined);
  });

  it("doesn't read the properties every object has", () => {
    for (const name of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      assert.strictEqual(lookup(categories, name, 'AhrefsBot'), undefined);
      assert.strictEqual(lookup(categories, 'Ahrefs', name), undefined);
    }
  });
});
