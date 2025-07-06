const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: './sdk-bundler/src/index.ts',
  output: {
    path: path.resolve(__dirname, '../public'),
    filename: 'unicity-sdk.js',
    library: {
      name: 'UnicitySDK',
      type: 'umd',
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "url": require.resolve("url/"),
      "buffer": require.resolve("buffer/"),
      "util": require.resolve("util/"),
      "process": require.resolve("process/browser"),
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
  ],
};