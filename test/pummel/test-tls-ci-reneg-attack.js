'use strict';
const common = require('../common');
const assert = require('assert');
const spawn = require('child_process').spawn;

if (!common.hasCrypto) {
  common.skip('missing crypto');
  return;
}
const tls = require('tls');

const fs = require('fs');

if (!common.opensslCli) {
  common.skip('node compiled without OpenSSL CLI.');
  return;
}

// renegotiation limits to test
const LIMITS = [0, 1, 2, 3, 5, 10, 16];

{
  let n = 0;
  function next() {
    if (n >= LIMITS.length) return;
    tls.CLIENT_RENEG_LIMIT = LIMITS[n++];
    test(next);
  }
  next();
}

function test(next) {
  const options = {
    cert: fs.readFileSync(common.fixturesDir + '/test_cert.pem'),
    key: fs.readFileSync(common.fixturesDir + '/test_key.pem')
  };

  let seenError = false;

  const server = tls.createServer(options, function(conn) {
    conn.on('error', function(err) {
      console.error('Caught exception: ' + err);
      assert(/TLS session renegotiation attack/.test(err));
      conn.destroy();
      seenError = true;
    });
    conn.pipe(conn);
  });

  server.listen(common.PORT, function() {
    const args = ('s_client -connect 127.0.0.1:' + common.PORT).split(' ');
    const child = spawn(common.opensslCli, args);

    //child.stdout.pipe(process.stdout);
    //child.stderr.pipe(process.stderr);

    child.stdout.resume();
    child.stderr.resume();

    // count handshakes, start the attack after the initial handshake is done
    let handshakes = 0;
    let renegs = 0;

    child.stderr.on('data', function(data) {
      if (seenError) return;
      handshakes += (('' + data).match(/verify return:1/g) || []).length;
      if (handshakes === 2) spam();
      renegs += (('' + data).match(/RENEGOTIATING/g) || []).length;
    });

    child.on('exit', function() {
      assert.strictEqual(renegs, tls.CLIENT_RENEG_LIMIT + 1);
      server.close();
      process.nextTick(next);
    });

    let closed = false;
    child.stdin.on('error', function(err) {
      switch (err.code) {
        case 'ECONNRESET':
        case 'EPIPE':
          break;
        default:
          assert.strictEqual(err.code, 'ECONNRESET');
          break;
      }
      closed = true;
    });
    child.stdin.on('close', function() {
      closed = true;
    });

    // simulate renegotiation attack
    function spam() {
      if (closed) return;
      child.stdin.write('R\n');
      setTimeout(spam, 50);
    }
  });
}
