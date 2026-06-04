module.exports = function (api) {
  api.cache(true);
  const isTest = process.env.NODE_ENV === 'test' || process.env.BABEL_ENV === 'test';
  return {
    presets: isTest ? ['babel-preset-expo'] : ['babel-preset-expo', 'nativewind/babel'],
  };
};
