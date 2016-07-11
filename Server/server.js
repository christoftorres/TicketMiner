#!/usr/bin/env node

/** 
  -- Server.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : July 2016
**/

var WebSocketServer    = require('websocket').server;
var https              = require('https');
var fs                 = require('fs');
var dispatcher         = require('httpdispatcher');
var moment             = require('moment');
var jsonfile           = require('jsonfile');
var cheerio            = require('cheerio');

var StratumClient      = require('./lib/StratumClient');
var WISchnorr          = require('./lib/WISchnorrServer');
var VariableDifficulty = require('./lib/VariableDifficulty');
var RingBuffer         = require('./lib/RingBuffer');
var ProfitCalculator   = require('./lib/MiningProfitabilityCalculator');

/* Internal variables */
console.log('Loading server configuration...');

const config      = jsonfile.readFileSync('config.json');
const HOST        = config.host;
const PORT        = config.port;
const SSL_OPTIONS = {
  key  : fs.readFileSync(config.ssl.key, 'utf8'),
  cert : fs.readFileSync(config.ssl.certificate, 'utf8')
};

// Variable difficulty configuration
var VAR_DIFF_CONFIG = {
  minDiff         : 1,  // Minimum difficulty
  maxDiff         : 16, // Maximum difficulty (usually the current pool's difficulty)
  targetTime      : 15, // Try to get 1 share per this many seconds
  retargetTime    : 15, // Check to see if we should retarget every this many seconds
  variancePercent : 20  // Allow time to very this % from target without retargeting
};

var connections = [];
var tickets     = [];
var items       = [];

// Load the list of already spent tickets
fs.stat('tickets.json', function(err, stat) {
  if (err == null) {
      tickets = jsonfile.readFileSync('tickets.json');
  } else if (err.code == 'ENOENT') {
      // File does not exist
      fs.writeFile('tickets.json', '[]');
  }
});

// Load the database of items (solely fot testing purposes)
if (jsonfile.readFileSync('test/items.json') != null) {
  items = jsonfile.readFileSync('test/items.json');
}

var current_block_reward     = 0.0; 
var current_block_difficulty = 0.0;
var current_conversion_rate  = 0.0;
var current_coin_rate        = 0.0;
var current_coin             = null;
var client                   = null;

var hashrates                = config.hashrates;
var server_hashrates         = [];

// Initialize server hashrates
for (var i = 0; i < 10; i++) { server_hashrates.push(0.0); }

/* Create a Schnorr keypair for partially blind signatures */
var schnorr = new WISchnorr();
var keypair = schnorr.GenerateSchnorrKeypair(config.schnorr_password);

/* Create an https server in order to handle http requests (Frontend) */
var httpsServer = https.createServer(SSL_OPTIONS, function(request, response) {
  try {
    dispatcher.dispatch(request, response);
  } catch(err) {
    logHTTP("Error: "+err);
  }
});

httpsServer.listen(PORT, function() {
  logHTTP("Server is listening on 'wss://"+HOST+':'+PORT+"'");
});

dispatcher.setStaticDirname('');
dispatcher.setStatic('lib/dashboard');
dispatcher.setStatic('test/items');

// Show server statistics
dispatcher.onGet("/", function(req, res) {
  fs.readFile('./lib/dashboard/production/index.html', function(error, content) {
    if (error) {
      res.end(500);
    } else {
      var server_hashrate = server_hashrates[server_hashrates.length-1];
      var i = -1;
      var byteUnits = [ ' KHs', ' MHs', ' GHs', ' THs', ' PHs' ];
      do {
          server_hashrate = server_hashrate / 1024;
          i++;
      } while (server_hashrate > 1024);
      server_hashrate = server_hashrate.toFixed(2) + byteUnits[i];
      var $ = cheerio.load(content);
      $('#clients').text(connections.length);
      $('#hashrate').text(server_hashrate);
      $('body').append('<script> var ctx = $("#hashRateChart"); var data = {labels: ["", "", "", "", "", "", "", "", "", ""], datasets: [{fill: true, lineTension: 0.1, backgroundColor: "rgba(75,192,192,0.4)", borderColor: "rgba(75,192,192,1)", borderCapStyle: "butt", borderDash: [], borderDashOffset: 0.0, borderJoinStyle: "miter", pointBorderColor: "rgba(75,192,192,1)", pointBackgroundColor: "#fff", pointBorderWidth: 1, pointHoverRadius: 5, pointHoverBackgroundColor: "rgba(75,192,192,1)", pointHoverBorderColor: "rgba(220,220,220,1)", pointHoverBorderWidth: 2, pointRadius: 1, pointHitRadius: 10, data: ['+server_hashrates[0]+', '+server_hashrates[1]+', '+server_hashrates[2]+', '+server_hashrates[3]+', '+server_hashrates[4]+', '+server_hashrates[5]+', '+server_hashrates[6]+', '+server_hashrates[7]+', '+server_hashrates[8]+', '+server_hashrates[9]+']}]}; var chart = new Chart(ctx, {type: "line", data: data, responsive: true, options: {tooltips : {callbacks: {label: function(tooltipItem, data) {return tooltipItem.yLabel + "'+byteUnits[i]+'";}}}, title: {display: false}, legend: {display: false}}}); </script>');
      $('#websocket_server').text(((wssServer) ? 'wss//'+HOST+':'+PORT : 'Not Running'));
      $('#ticket_expiration').text(config.ticket_expiration+' Days');
      $('#donations_minimum_amount').text(config.donations.minimum_amount.toFixed(2)+' '+config.currency);
      $('#donations_default_amount').text(config.donations.default_amount.toFixed(2)+' '+config.currency);
      res.end($.html(), 'utf-8');
    }
  });
});

// Show clients statistics
dispatcher.onGet("/clients", function(req, res) {
  fs.readFile('./lib/dashboard/production/clients.html', function(error, content) {
    if (error) {
      res.end(500);
    } else {
      var $ = cheerio.load(content);
      var mining_clients = 0;
      for (var index in connections) {
        if (connections[index].uuid != undefined) {
          var client_hashrate = connections[index].hashRate.avg();
          var i = -1;
          var byteUnits = [ ' KHs', ' MHs', ' GHs', ' THs', ' PHs' ];
          do {
              client_hashrate = client_hashrate / 1024;
              i++;
          } while (client_hashrate > 1024);
          client_hashrate = client_hashrate.toFixed(2) + byteUnits[i];
          $('.countries_list').append('<tr><td>'+connections[index].uuid+'</td><td>'+connections[index].difficulty+'</td><td>'+connections[index].submittedShares+'</td><td>'+client_hashrate+'</td><td>'+String(connections[index].donate).charAt(0).toUpperCase()+String(connections[index].donate).slice(1)+'</td></tr>');
          mining_clients++;
        }
      }
      $('#clients').text(mining_clients);
      res.end($.html(), 'utf-8');
    }
  });
});

// Show mining pool statistics
dispatcher.onGet("/miningpool", function(req, res) {
  fs.readFile('./lib/dashboard/production/miningpool.html', function(error, content) {
    if (error) {
      res.end(500);
    } else {
      var $ = cheerio.load(content);
      $('#shares_submitted').text(((client) ? client.submittedShares : '0'));
      $('#shares_accepted').text(((client) ? client.acceptedShares : '0'));
      $('#shares_rejected').text(((client) ? client.rejectedShares : '0'));
      $('#status').text(((client && client._connection) ? 'Connected' : 'Not Connected'));
      $('#pool').text(((current_coin) ? current_coin.pool.host+':'+current_coin.pool.port : 'No Pool'));
      $('#authorized').text(((client) ? String(client._authorized).charAt(0).toUpperCase()+String(client._authorized).slice(1) : 'False'));
      $('#pool_fee').text(((current_coin) ? current_coin.pool_fee : '0')+'%');
      $('#pool_difficulty').text(((client) ? client._difficulty : '0'));
      $('#shares_received').text(((client) ? client.receivedShares : '0'));
      $('#shares_registered').text(((client) ? client.registeredShares.length : '0'));
      $('#algorithm').text(((client) ? client.algorithm.charAt(0).toUpperCase()+client.algorithm.slice(1) : 'No Algorithm'));
      $('#job').text(((client) ? ((client.getJob()) ? ((client.algorithm == 'ethash') ? '0x'+client.getJob().header_hash : '0x'+client.getJob().job_id) : 'No Job') : 'No Job'));
      res.end($.html(), 'utf-8');
    }
  });
});

// Show current coin statistics
dispatcher.onGet("/currentcoin", function(req, res) {
  fs.readFile('./lib/dashboard/production/currentcoin.html', function(error, content) {
    if (error) {
      res.end(500);
    } else {
      var $ = cheerio.load(content);
      $('#current_coin').text(((current_coin) ? current_coin.coin_name+' ('+current_coin.coin_symbol+')' : 'No Coin'));
      $('#algorithm').text(((current_coin) ? current_coin.pool.algorithm.charAt(0).toUpperCase()+current_coin.pool.algorithm.slice(1) : 'No Algorithm'));
      $('#choose_most_profitable_coin').text(String(config.choose_most_profitable_coin).charAt(0).toUpperCase()+String(config.choose_most_profitable_coin).slice(1));
      $('#conversion_rate_poll_time').text((config.conversion_rate_poll_time / 1000) + 's');
      $('#most_profitable_coin_poll_time').text((config.most_profitable_coin_poll_time / 1000) + 's');
      $('#coin_information_poll_time').text((config.coin_information_poll_time / 1000) + 's');
      $('#default_coin').text(config.default_coin);
      $('#block_reward').text(current_block_reward+' '+((current_coin) ? current_coin.coin_symbol : ''));
      $('#block_difficulty').text(current_block_difficulty);
      $('#conversion_rate').text(((current_coin) ? '1 '+current_coin.coin_symbol+' = '+current_coin_rate+' BTC' : '0 BTC'));
      $('#exchange_rate').text('1 BTC = '+current_conversion_rate+' '+config.currency);
      res.end($.html(), 'utf-8');
    }
  });
}); 

dispatcher.onError(function(req, res) {
  res.writeHead(404);
  res.end();
});

/* Create a secure websocket server in order to handle ws requests (Backend) */
var wssServer = new WebSocketServer({
    httpServer: httpsServer, autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // We only allow our browser add-on to connect to ourselfs
  if (origin == 'ticketminer') {
    return true;
  } else {
    logHTTP("Unknown origin: "+origin);
    return false;
  }
}

wssServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      logHTTP("Connection from origin "+request.origin+" rejected.");
      return;
    }

    // Accept the connection
    var connection = request.accept('ticket-miner-protocol', request.origin);
    logHTTP(connection.remoteAddress+" Connection accepted.");
      
    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            var message = JSON.parse(message.utf8Data);
            // A client wants to make a donation
            if (message.command == 'DONATION') {
              connection.sendUTF(JSON.stringify({ command : 'DONATION', data : { defaultAmount : config.donations.default_amount, currency : config.currency } }));
            } else
            // A client wants to purchase an item
            if (message.command == 'PURCHASE') {
              for (var i in items) {
                if (items[i].itemID == parseInt(message.data.itemID)) {
                  connection.sendUTF(JSON.stringify({ command : 'PURCHASE', data : { itemID : items[i].itemID, price : items[i].price, currency : config.currency, description : items[i].description } }));
                  break;
                }
              }
            } else
            // A client wants to submit tickets
            if (message.command == 'SUBMIT_TICKETS') {
              var received_tickets = message.data.tickets;
              var type             = message.data.type;
              var amount           = 0.0;
              for (var i in received_tickets) {
                // Check the origin
                if (received_tickets[i].origin.indexOf(HOST) == -1) {
                  connection.sendUTF(JSON.stringify({ command : 'TICKET_ERROR', data : 4 }));
                  return;   
                }
                for (var j in tickets) {
                  if (tickets[j].info.hash === received_tickets[i].info.hash) {
                    // Ticket has already been spent
                    connection.sendUTF(JSON.stringify({ command : 'TICKET_ERROR', data : 0 }));
                    return;   
                  }
                }
                // Check the expiration date
                if (moment.utc().startOf('day').unix().toString() > received_tickets[i].info.expiration) {
                  // Ticket has expired...
                  connection.sendUTF(JSON.stringify({ command : 'TICKET_ERROR', data : 1 }));
                  return;
                }
                // Check the signature
                if (!schnorr.VerifyWISchnorrBlindSignature(received_tickets[i].signature, JSON.stringify(received_tickets[i].info), received_tickets[i].secret)) {
                  // Ticket is not valid
                  connection.sendUTF(JSON.stringify({ command : 'TICKET_ERROR', data : 2 }));
                  return;
                }
                amount += received_tickets[i].info.value;
              }
              if ((type == 'donation' && amount < config.donations.minimum_amount) || (type == 'purchase' && amount < 0.02)) {
                // Amount of submitted tickets is not sufficient
                connection.sendUTF(JSON.stringify({ command : 'TICKET_ERROR', data : 3 }));
                return;
              }
              // Create return ticket if necessary
              if (amount > parseFloat(message.data.amount) && message.data.hash != null) {
                var info = {};
                info['hash']       = message.data.hash;
                info['value']      = parseFloat(amount) - parseFloat(message.data.amount);
                info['timestamp']  = moment.utc().startOf('day').unix();
                info['expiration'] = moment().add(config.ticket_expiration, 'days').utc().startOf('day').unix();
                var params = schnorr.GenerateWISchnorrParams(JSON.stringify(info));  
                connection['WISchnorrParams'] = params;
                connection.sendUTF(JSON.stringify({ command : 'WISCHNORR_PARAMS', data : { params : params.public, info : info } }));
              }
              if (type == 'donation') {
                connection.sendUTF(JSON.stringify({ command : 'TICKETS_VALID', data : null }));
              } else {
                for (var i in items) {
                  if (items[i].itemID == parseInt(message.data.itemID)) {
                    connection.sendUTF(JSON.stringify({ command : 'TICKETS_VALID', data : 'https://'+HOST+':'+PORT+'/test/items/'+items[i].file }));
                    break;
                  }
                }
              }
              // Store the tickets

              for (var i in received_tickets) {
                tickets.push(received_tickets[i]);
              }
              storeData('tickets.json', tickets);
            }
            // A miner wants to subscribe
            if (message.command == 'SUBSCRIBE') {
              var uuid = require('node-uuid').v4();
              if (client && client._difficulty) VAR_DIFF_CONFIG.maxDiff = client._difficulty;
              var varDiff = new VariableDifficulty(VAR_DIFF_CONFIG);
              var difficulty = varDiff.computeNewDifficulty(varDiff._options.maxDiff);
              logHTTP('UUID: '+uuid);
              connection.sendUTF(JSON.stringify({ command : 'SUBSCRIBE' , data : { publicKey : schnorr.ExtractPublicKey() } }));
              if (client) {
                connection.sendUTF(JSON.stringify({ command : 'JOB'  , data : { algorithm : current_coin.pool.algorithm, job : client.getJob(), difficulty : difficulty } }));
              } 
              connections.push({ uuid : uuid, connection : connection, varDiff : varDiff, difficulty : difficulty, submittedShares : 0, hashRate : new RingBuffer(1000), startTime : Date.now(), jobStartTime : Date.now(), donate : message.data.donate });
            } else
            // A miner wants to submit a share
            if (message.command == 'SUBMIT_JOB') {
              var current_time = Date.now();
              for (var index in connections) {
                if (connections[index].connection == connection) {
                  // Compute client hashrate
                  var elapsed_time = current_time - connections[index].jobStartTime;
                  connections[index].submittedShares++;
                  var hashRate = Math.pow(2, 16) * (connections[index].difficulty * connections[index].submittedShares) / (elapsed_time / 1000);
                  connections[index].hashRate.append(hashRate);
                  for (var i in hashrates) {
                    if (hashrates[i].algorithm == current_coin.pool.algorithm) {
                      var server_hashrate = 0.0;
                      for (var j in connections) {
                        server_hashrate += connections[j].hashRate.avg();
                      }
                      server_hashrate /= connections.length;
                      for (var k = 0; k < server_hashrates.length-1; k++) {
                          server_hashrates[k] = server_hashrates[k+1];
                      }
                      server_hashrates[server_hashrates.length-1] = server_hashrate;
                      var hashrate_unit = hashrates[i].hashrate_unit;
                      var divisor = 1000;
                      if (hashrate_unit == "MH/s") {
                        divisor = 1000000;
                      }
                      if (hashrate_unit == "GH/s") {
                        divisor = 1000000000;
                      }
                      server_hashrate /= divisor;
                      hashrates[i].default_hashrate = server_hashrate;
                      break;    
                    }
                  }
                  var share = message.data.share;
                  if (client.submitJob(connections[index].uuid, share, connections[index].difficulty)) {
                    // Compute new client difficulty
                    connections[index].difficulty = connections[index].varDiff.computeNewDifficulty(connections[index].difficulty);
                    // Compute value of the share
                    var reward = (current_block_reward - (current_block_reward * current_coin.pool_fee / 100)) / current_block_difficulty;  
                    var value = ((reward * current_conversion_rate * current_coin_rate) / client._difficulty) * connections[index].difficulty;
                    if (connections[index].donate) {
                      connection.sendUTF(JSON.stringify({ command : 'DONATED_AMOUNT', data : { amount : value } }));
                    } else {
                      // Create a ticket
                      var info = {};
                      info['hash']       = message.data.hash;
                      info['value']      = value;
                      info['timestamp']  = moment.utc().startOf('day').unix().toString();
                      info['expiration'] = moment().add(config.ticket_expiration, 'days').utc().startOf('day').unix().toString();
                      var params = schnorr.GenerateWISchnorrParams(JSON.stringify(info));  
                      connection['WISchnorrParams'] = params;
                      connection.sendUTF(JSON.stringify({ command : 'WISCHNORR_PARAMS', data : { params : params.public, info : info } }));
                    }
                  }
                  break;
                }
              }
            } else
            // A miner is submitting a challenge for the signature of a ticket
            if (message.command == 'WISCHNORR_CLIENT_CHALLENGE') {
              var response = schnorr.GenerateWISchnorrServerResponse(connection.WISchnorrParams.private, message.data.e);
              connection.sendUTF(JSON.stringify({ command : 'WISCHNORR_SERVER_RESPONSE', data : { response : response } }));
            }
        }
    }.bind(this));
    connection.on('close', function(reasonCode, description) {
        // A client disconnected, remove him from the list of connected clients
        logHTTP("Client "+connection.remoteAddress+" disconnected.");
        for (var index in connections) {
            if (connection == connections[index].connection) {
                connections.splice(index, 1);   
            }
        }
    }.bind(this));
}.bind(this));

// Looks up the current Bitcoin conversion rate
function checkConversionRate() {
  new ProfitCalculator().getConversionRate(config.currency, function(conversion_rate) {
    current_conversion_rate = conversion_rate;
  });
}
checkConversionRate();
setInterval(checkConversionRate, config.conversion_rate_poll_time);

if (config.choose_most_profitable_coin) {
  // Looks up the current most profitable cryptocurrency and switches automatically to it
  function checkMostProfitableCoin() {
    new ProfitCalculator().getMostProfitableCoin(hashrates, config.coins, "Coinbase", createStratumClient);
  }
  checkMostProfitableCoin();
  setInterval(checkMostProfitableCoin, config.most_profitable_coin_poll_time);
} else {
  // Looks up the coin information for the default coin
  function checkDefaultCoinInformation() {
    var coin = null;
    for (var i in config.coins) {
      if (config.coins[i].coin_name == config.default_coin) {
        coin = config.coins[i];
        break;
      }
    }
    new ProfitCalculator().getCoinInformation(coin , createStratumClient);
  }
  checkDefaultCoinInformation();
  setInterval(checkDefaultCoinInformation, config.coin_information_poll_time);
}

function createStratumClient(block_reward, block_difficulty, coin_rate, coin) {
  /* Create a stratum client that gets the mining jobs from a mining pool */
  if (current_coin != coin) {
    current_block_reward     = parseFloat(block_reward); 
    current_block_difficulty = parseFloat(block_difficulty);
    current_coin_rate        = parseFloat(coin_rate);
    current_coin             = coin;
    
    logHTTP('Current most profitable currency: '+current_coin.coin_name+' ('+current_coin.coin_symbol+')');
      
    // Stop and destroy current stratum client    
    if (client != null) {
      client.stop(); 
      client = null;
    }

    // Create a new stratum client based on the current most profitable cryptocurrency
    client = new StratumClient(current_coin.pool);

    client.onEvent = function(e) {
      if (e.notification != null) {
        switch(e.notification) {
          // Mining pool sends a new job
          case StratumClient.NOTIFICATION.NEW_WORK: 
            for (var index in connections) {
              connections[index].connection.sendUTF(JSON.stringify({ command : 'JOB', data : { algorithm : current_coin.pool.algorithm, job : e.job, difficulty : connections[index].difficulty } }));
              connections[index].jobStartTime = Date.now();
            }
            break;  
          // Mining pool changed difficulty
          case StratumClient.NOTIFICATION.NEW_DIFFICULTY: 
            VAR_DIFF_CONFIG.maxDiff = e.difficulty;
            for (var index in connections) {
              if (connections[index].varDiff) {
                connections[index].varDiff._options.maxDiff = e.difficulty;
                var difficulty = connections[index].varDiff.computeNewDifficulty(connections[index].varDiff._options.maxDiff);
                connections[index].difficulty = difficulty;
              }
            }
            break;  
          // Server accepts share
          case StratumClient.NOTIFICATION.POW_TRUE: 
            for (var index in connections) {
              if (connections[index].uuid == e.uuid) {
                connections[index].connection.sendUTF(JSON.stringify({ command : 'SHARE_ACCEPTED' }));
              }
            }
            break;
          // Server rejects share
          case StratumClient.NOTIFICATION.POW_FALSE: 
            for (var index in connections) {
              if (connections[index].uuid == e.uuid) {
                connections[index].connection.sendUTF(JSON.stringify({ command : 'SHARE_REJECTED' }));
              }
            }
            break;
          default:
            break;      
        }
      }
    }.bind(this);

    // Start the stratum client
    client.start();
  }
}

// Stores data to a local file
function storeData(file, data) {
  jsonfile.writeFile(file, data, function(err) {
    if (err != null) console.log('Error storing data: '+err);
  });
}

// Logs messages from the HTTP web server
function logHTTP(message) {
  var date = new Date();
  var format = date.getFullYear()+"-"+(date.getMonth()+1)+"-"+date.getDate()+" "+date.getHours()+":"+date.getMinutes()+":"+date.getSeconds();
  console.log("[HTTP] "+format+" "+message);
};
