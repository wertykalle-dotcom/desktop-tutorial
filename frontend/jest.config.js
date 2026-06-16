module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/tests/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
