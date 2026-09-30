const { createMemoryStorage } = require('../../helpers/memory-storage');

const { storageContract } = require('./contract');

storageContract('in-memory fake', () => createMemoryStorage());
