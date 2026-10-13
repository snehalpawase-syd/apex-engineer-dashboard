'use strict'
/*
 * Copyright (c) 2017, Bubelich Mykola
 * https://www.bubelich.com
 * All rights reserved.
 * License: BSD-3-Clause
 */

var JSSalsa20 = function (key, nonce) {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error('Key should be 32 byte array!')
  }

  if (!(nonce instanceof Uint8Array) || nonce.length !== 8) {
    throw new Error('Nonce should be 8 byte array!')
  }

  this.rounds = 20
  this.sigma = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]
  this.param = [
    this.sigma[0],
    this._get32(key, 0),
    this._get32(key, 4),
    this._get32(key, 8),
    this._get32(key, 12),
    this.sigma[1],
    this._get32(nonce, 0),
    this._get32(nonce, 4),
    0,
    0,
    this.sigma[2],
    this._get32(key, 16),
    this._get32(key, 20),
    this._get32(key, 24),
    this._get32(key, 28),
    this.sigma[3]
  ]

  this.block = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]

  this.byteCounter = 0
}

JSSalsa20.prototype._update = function (data) {
  if (!(data instanceof Uint8Array) || data.length === 0) {
    throw new Error('Data should be type of bytes (Uint8Array) and not empty!')
  }

  var output = new Uint8Array(data.length)

  for (var i = 0; i < data.length; i++) {
    if (this.byteCounter === 0 || this.byteCounter === 64) {
      this._salsa()
      this._counterIncrement()
      this.byteCounter = 0
    }

    output[i] = data[i] ^ this.block[this.byteCounter++]
  }

  return output
}

JSSalsa20.prototype.encrypt = function (data) {
  return this._update(data)
}

JSSalsa20.prototype.decrypt = function (data) {
  return this._update(data)
}

JSSalsa20.prototype._counterIncrement = function () {
  this.param[8] = (this.param[8] + 1) >>> 0
  if (this.param[8] === 0) {
    this.param[9] = (this.param[9] + 1) >>> 0
  }
}

JSSalsa20.prototype._salsa = function () {
  var mix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  var i = 0
  var b = 0

  for (i = 0; i < 16; i++) {
    mix[i] = this.param[i]
  }

  for (i = 0; i < this.rounds; i += 2) {
    mix[4] = (mix[4] ^ this._rotl(mix[0] + mix[12], 7)) >>> 0
    mix[8] = (mix[8] ^ this._rotl(mix[4] + mix[0], 9)) >>> 0
    mix[12] = (mix[12] ^ this._rotl(mix[8] + mix[4], 13)) >>> 0
    mix[0] = (mix[0] ^ this._rotl(mix[12] + mix[8], 18)) >>> 0
    mix[9] = (mix[9] ^ this._rotl(mix[5] + mix[1], 7)) >>> 0
    mix[13] = (mix[13] ^ this._rotl(mix[9] + mix[5], 9)) >>> 0
    mix[1] = (mix[1] ^ this._rotl(mix[13] + mix[9], 13)) >>> 0
    mix[5] = (mix[5] ^ this._rotl(mix[1] + mix[13], 18)) >>> 0
    mix[14] = (mix[14] ^ this._rotl(mix[10] + mix[6], 7)) >>> 0
    mix[2] = (mix[2] ^ this._rotl(mix[14] + mix[10], 9)) >>> 0
    mix[6] = (mix[6] ^ this._rotl(mix[2] + mix[14], 13)) >>> 0
    mix[10] = (mix[10] ^ this._rotl(mix[6] + mix[2], 18)) >>> 0
    mix[3] = (mix[3] ^ this._rotl(mix[15] + mix[11], 7)) >>> 0
    mix[7] = (mix[7] ^ this._rotl(mix[3] + mix[15], 9)) >>> 0
    mix[11] = (mix[11] ^ this._rotl(mix[7] + mix[3], 13)) >>> 0
    mix[15] = (mix[15] ^ this._rotl(mix[11] + mix[7], 18)) >>> 0
    mix[1] = (mix[1] ^ this._rotl(mix[0] + mix[3], 7)) >>> 0
    mix[2] = (mix[2] ^ this._rotl(mix[1] + mix[0], 9)) >>> 0
    mix[3] = (mix[3] ^ this._rotl(mix[2] + mix[1], 13)) >>> 0
    mix[0] = (mix[0] ^ this._rotl(mix[3] + mix[2], 18)) >>> 0
    mix[6] = (mix[6] ^ this._rotl(mix[5] + mix[4], 7)) >>> 0
    mix[7] = (mix[7] ^ this._rotl(mix[6] + mix[5], 9)) >>> 0
    mix[4] = (mix[4] ^ this._rotl(mix[7] + mix[6], 13)) >>> 0
    mix[5] = (mix[5] ^ this._rotl(mix[4] + mix[7], 18)) >>> 0
    mix[11] = (mix[11] ^ this._rotl(mix[10] + mix[9], 7)) >>> 0
    mix[8] = (mix[8] ^ this._rotl(mix[11] + mix[10], 9)) >>> 0
    mix[9] = (mix[9] ^ this._rotl(mix[8] + mix[11], 13)) >>> 0
    mix[10] = (mix[10] ^ this._rotl(mix[9] + mix[8], 18)) >>> 0
    mix[12] = (mix[12] ^ this._rotl(mix[15] + mix[14], 7)) >>> 0
    mix[13] = (mix[13] ^ this._rotl(mix[12] + mix[15], 9)) >>> 0
    mix[14] = (mix[14] ^ this._rotl(mix[13] + mix[12], 13)) >>> 0
    mix[15] = (mix[15] ^ this._rotl(mix[14] + mix[13], 18)) >>> 0
  }

  for (i = 0; i < 16; i++) {
    mix[i] += this.param[i]
    this.block[b++] = mix[i] & 0xFF
    this.block[b++] = (mix[i] >>> 8) & 0xFF
    this.block[b++] = (mix[i] >>> 16) & 0xFF
    this.block[b++] = (mix[i] >>> 24) & 0xFF
  }
}

JSSalsa20.prototype._get32 = function (data, index) {
  return data[index++] ^ (data[index++] << 8) ^ (data[index++] << 16) ^ (data[index] << 24)
}

JSSalsa20.prototype._rotl = function (data, shift) {
  return ((data << shift) | (data >>> (32 - shift)))
}

window.JSSalsa20 = JSSalsa20;
