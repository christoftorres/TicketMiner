/** 
  -- main.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : July 2016
**/

// Load the required modules
var { ToggleButton } = require('sdk/ui/button/toggle');
var panels           = require("sdk/panel");
var self             = require("sdk/self");
var tabs             = require("sdk/tabs");
var pageMod          = require("sdk/page-mod");
var ss               = require("sdk/simple-storage");
var sp               = require("sdk/simple-prefs");
var notifications    = require("sdk/notifications");
let { Cu, Ci, Cc }   = require('chrome');

const { OS } = Cu.import("resource://gre/modules/osfile.jsm", {});

// Create the local storage objects if they are non-existing
if (!ss.storage.servers) ss.storage.servers = {};
if (!ss.storage.tickets) ss.storage.tickets = []; 
if (!ss.storage.jobs)    ss.storage.jobs    = []; 

// Warn the user if the application is out of memory
ss.on("OverQuota", function() {
  notify("TicketMiner is out of memory! Please delete some jobs or spend some tickets!");
});

// Initialize the global payment variable
var payment = null;

// Initialize the different sized button icons
var button_icons = {
  "16": "./icons/icon-16.png",
  "32": "./icons/icon-32.png",
  "64": "./icons/icon-64.png"
};

// Create the add-on button for the toolbar
var button = ToggleButton({
  id         : "miner-button",
  label      : "TicketMiner",
  icon       : button_icons,
  onClick    : handleChange,
  badge      : getActiveJobs(),
  badgeColor : ((getActiveJobs() == 0) ? "#1977B1" : "#4CAF50")
});

// Create the panel for the menu of the application
var panel = panels.Panel({
  width             : 180,
  height            : 220,
  contentURL        : self.data.url("index.html"),
  contentScriptFile : self.data.url("index.js"),
  onHide            : handleHide,
  onShow            : function() {
    panel.resize(180, 220);
  }
});

// Change the height of the panel
panel.port.on('change-panel-size', function(data) {
  if (data == 'extended-view') {
    panel.resize(panel.width, 322);
  } else {
    panel.resize(panel.width, 220);
  }
});

// Create a page worker that listens to events coming from websites
pageMod.PageMod({
  include: "*",
  contentScriptFile: self.data.url("../lib/Request.js"),
  onAttach: function(worker) {
    // Donation event
    worker.port.on("donate-by-ticket-request", function(details) {
      var request = JSON.parse(details);
      if (ss.storage.servers[request.origin]) {
        var server = ss.storage.servers[request.origin];
        // Create a donation request
        createDonationRequest(server.url);
      } else {
        notify("Error: No service is running on "+request.origin);
      }
    });
    // Purchase event
    worker.port.on("pay-by-ticket-request", function(details) {
      var request = JSON.parse(details);
      if (ss.storage.servers[request.origin]) {
        var server = ss.storage.servers[request.origin];
        // Create a purchase request
        createPurchaseRequest(server.url, request.itemID);
      } else {
        notify("Error: No service is running on "+request.origin);
      }
    });
  }
});

// Load jobs on start up
if (self.loadReason == "startup") {
  for (var index in ss.storage.jobs) {
    // Load a new miner instance into memory
    ss.storage.jobs[index].miner = createNewMiner(ss.storage.jobs[index], ss.storage.jobs[index].server, ss.storage.jobs[index].threads, ss.storage.jobs[index].donate);
    // Strat the miner in case he was runnning before the application was closed
    if (ss.storage.jobs[index].status == 'Running') {
      ss.storage.jobs[index].miner.port.emit("start-mining");
    }
  }
}

// Start current miner when its tab gets active and stop the other miners
tabs.on("activate", function(tab) {
  activeTabMining(tab)
});

// Listen to requests to create a new job together with a new miner
panel.port.on("start-miner", function(message) {
  panel.hide();
  // Create a new job...
  var job = {
    id              : ss.storage.jobs.length,
    server          : message.server,
    threads         : message.threads,
    donate          : message.donate,
    miner           : null,
    status          : 'Not running',
    algorithm       : '',
    difficulty      : 0,
    hashRateQueue   : [],
    hashRateChart   : null,
    hashRate        : 0,
    avgHashRate     : 0,
    duration        : 0,
    amount          : 0.0,
    submittedShares : 0,
    acceptedShares  : 0,
    rejectedShares  : 0
  };
  // Initialize hashrate queue
  for (var i = 0; i < 10; i++) {
      job.hashRateQueue.push(0);   
  }
  // Tell the UI that a new job was created
  panel.port.emit("new-job", { job : job });
  // Create a new miner...
  job.miner = createNewMiner(job, message.server, message.threads, message.donate);
  // Store the new job
  ss.storage.jobs.push(job);
  // Start mining...
  job.miner.port.emit("start-mining");
  notify("New mining job started for "+getHostName(message.server)+"!");
  // Update the number of active jobs
  button.badge = getActiveJobs();
  button.badgeColor = ((getActiveJobs() == 0) ? "#1977B1" : "#4CAF50");
});

// Listen to requests to start mining
panel.port.on("start-mining-job", function(message) {
  for (var index in ss.storage.jobs) {
    if (ss.storage.jobs[index].id == message.id) {
      // Start the miner
      ss.storage.jobs[index].miner.port.emit("start-mining");
      break;
    }
  }
});

// Listen to requests to stop mining
panel.port.on("stop-mining-job", function(message) {
  for (var index in ss.storage.jobs) {
    if (ss.storage.jobs[index].id == message.id) {
      // Stop the miner
      ss.storage.jobs[index].miner.port.emit("stop-mining");
      break;
    }
  }
});

// Listen to requests to delete a mining job
panel.port.on("delete-mining-job", function(message) {
  for (var index in ss.storage.jobs) {
    if (ss.storage.jobs[index].id == message.id) {
      // Stop the miner
      ss.storage.jobs[index].miner.port.emit("stop-mining");
      // Delete the miner
      ss.storage.jobs[index].miner = null;
      // Remove the job
      ss.storage.jobs.splice(index, 1);
      // Update the number of active jobs
      button.badge = getActiveJobs();
      button.badgeColor = ((getActiveJobs() == 0) ? "#1977B1" : "#4CAF50");
      break;
    }
  }   
});

// Listen to rquests to delete a ticket
panel.port.on("delete-ticket", function(message) {
  for (var index in ss.storage.tickets) {
    if (ss.storage.tickets[index].info.hash == message.ticket.info.hash) {
      // Remove the ticket
      ss.storage.tickets.splice(index, 1);
      break;
    }
  } 
});

// Listen to requests to update the preferences
panel.port.on("update-preferences", function(message) {
  // Store the new preferences
  sp.prefs.notifications   = message.preferences.notifications;
  sp.prefs.activeTabMining = message.preferences.activeTabMining;
  sp.prefs.ethashClient    = message.preferences.ethashClient;
  sp.prefs.currency        = message.preferences.currency;
  // Start the miner of the current active tab (in case it's enabled)
  if (sp.prefs.activeTabMining) {
    activeTabMining(tabs.activeTab);
  }
  // Update the miners about the new Ethash client type (full or light)
  for (var index in ss.storage.jobs) {
    ss.storage.jobs[index].miner.port.emit("set-ethash-client", sp.prefs.ethashClient);
  }
});

// Delete all the stored data
panel.port.on("delete-storage", function() {
  // Delete list of servers, tickets and jobs
  ss.storage.servers = {};
  ss.storage.tickets = [];
  ss.storage.jobs    = [];
  // Delete stored Ethash caches and datasets
  OS.File.removeDir("ethash");
});

// Create an HTTP observer
Cu.import('resource://gre/modules/Services.jsm');
var httpObserver = {
  // Observe HTTP requests and responses
  observe: function (subject, topic, data) {
    if (topic == "http-on-modify-request") {
      subject.QueryInterface(Ci.nsIHttpChannel);
      this.onExamineRequest(subject);        
    } else
    if (topic == "http-on-examine-response") {
      subject.QueryInterface(Ci.nsIHttpChannel);
      this.onExamineResponse(subject);
    }
  },
  // On HTTP requests set an origin request header containing the id of our add-on
  onExamineRequest: function (http) {
    try {
      http.setRequestHeader("Origin", self.id.replace('@',''), false);
    } catch(e) {

    }                    
  },
  // On HTTP responses read the "X-TicketMiner-Service" response header and store the server url
  onExamineResponse: function (http) {
    try {
      var url = http.getResponseHeader("X-TicketMiner-Service");
      var hostname = getHostName(http.URI.spec);
      ss.storage.servers[hostname] = { url: url };
    } catch(e) {

    }
  }
}

// Add the HTTP observer for HTTP requests and responses
Services.obs.addObserver(httpObserver, "http-on-modify-request", false);
Services.obs.addObserver(httpObserver, "http-on-examine-response", false);

// Hanlde state changes of the toolbar button 
function handleChange(state) {
  if (state.checked) {
    button.icon = button_icons;
    // Show panel containig the application menu
    panel.show({
      position: button
    });
    // Get server url for the current active tab
    var server = null;
    if (ss.storage.servers[getHostName(tabs.activeTab.url)]) {
      server = ss.storage.servers[getHostName(tabs.activeTab.url)].url;
    }
    // Get the current settings to be passed to the panel
    var preferences = {
      notifications   : sp.prefs.notifications,
      activeTabMining : sp.prefs.activeTabMining,
      ethashClient    : sp.prefs.ethashClient,
      currency        : sp.prefs.currency,
      storage         : ss.quotaUsage
    };
    // Pass server url, tickets, jobs and settings to the panel 
    panel.port.emit("show-menu", JSON.stringify({ server : server, tickets : ss.storage.tickets, jobs : ss.storage.jobs, preferences : preferences }));
  }
}

// Handle the hide event of the toolbar button
function handleHide() {
  button.state('window', {checked: false});
}

// Get the hostname of a url
function getHostName(url) {
  var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i);
  if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
    return match[2];
  } else {
    return null;
  }
}

// Start miner for current active tab
function activeTabMining(tab) {
  if (sp.prefs.activeTabMining) {
    // Stop all miners when current active tab is a new empty tab
    if (tab.url == 'about:newtab') {
      for (var index in ss.storage.jobs) {
        ss.storage.jobs[index].miner.port.emit("stop-mining");
      }
    } else {
      var server = ss.storage.servers[getHostName(tab.url)];
      for (var index in ss.storage.jobs) {
        var job = ss.storage.jobs[index];
        // Start miner if its tab is currently active
        if (server != undefined && job.server == server.url) {
          if (job.status != 'Running') {
            job.miner.port.emit("start-mining");
          }
        } else {
          // Stop miner if its tab is currently not active
          job.miner.port.emit("stop-mining");
        }
      }
    }
  }
}

// Send a donation request to the server
function createDonationRequest(server) {
  // Initialize a donation payment request
  payment = createPaymentRequest(server, 'donation');
  // Listen to a donation server response
  payment.port.on("donation-response", function(response) {
    // Show the donation server response to the user
    panel.show({ position : button });
    button.state('window', { checked : true });
    panel.port.emit("donation-request", JSON.stringify({ server : server, response : response, balance : getBalance(server), currency : sp.prefs.currency }));
    // Listen to the donation reponse of the user
    panel.port.on("donation-response", function(message) {
      panel.hide();
      // Submit the tickets to the server if the user accepts the donation request
      if (message.response == 'accept') {
        var tickets = getTickets(server, message.amount);
        payment.port.emit("submit-donation", tickets, message.amount);
        // Delete the tickets if payment if valid
        payment.port.on("payment-valid", function() {
          deleteTickets(tickets);
          notify("Donation was successful!");
          destroyPaymentRequest();
        });
        // Store new return ticket if received
        payment.port.on("new-ticket", function(ticket) {
          storeNewTicket(ticket);
        });
        // Notify the user in case of a payment error
        payment.port.on("payment-error", function(message) {
          showPaymentError(message);
          destroyPaymentRequest();
        });
      } else {
        destroyPaymentRequest();
        // Show miner in case user decided to mine because of insufficient balance
        if (message.response == 'mine') {
          panel.show({ position : button });
          button.state('window', { checked : true });
          panel.port.emit("show-miner", JSON.stringify({ server : server }));
        }
      }
    });
  });
  // Donation request connection error
  payment.port.on("payment-connection-error", function() {
    notify("Connection error! Could not connect to: "+server);
  });
}

// Send a purchase request to the server together with the item ID
function createPurchaseRequest(server, itemID) {
  // Initialize a purchase payment request
  payment = createPaymentRequest(server, 'purchase', itemID);
  // Listen to a purchase server response
  payment.port.on("purchase-response", function(response) {
    // Show the purchase server response to the user
    panel.show({ position : button });
    button.state('window', { checked : true });
    panel.port.emit("purchase-request", JSON.stringify({ server : server, response : response, balance : getBalance(server), currency : sp.prefs.currency }));
    // Listen to the purchase reponse of the user
    panel.port.on("purchase-response", function(message) {
      panel.hide();
      // Submit the tickets to the server if the user accepts the purchase request
      if (message.response == 'accept') {
        var tickets = getTickets(server, response.price);
        payment.port.emit("submit-purchase", tickets, response.price);
        // Download the item and delete the tickets if the purchase is valid
        payment.port.on("payment-valid", function(data) {
          notify("Payment was successful!");
          Cu.import("resource://gre/modules/Downloads.jsm");
          Cu.import("resource://gre/modules/osfile.jsm")
          Cu.import("resource://gre/modules/Task.jsm");
          Task.spawn(function () {
            yield Downloads.fetch(data,
            OS.Path.join(OS.Path.join(OS.Constants.Path.homeDir, "Downloads"), OS.Path.basename(data)));   
            deleteTickets(tickets);
          }).then(null, Cu.reportError);
          destroyPaymentRequest();
        });
        // Store new return ticket if received
        payment.port.on("new-ticket", function(ticket) {
          storeNewTicket(ticket);
        });
        // Notify the user in case of a payment error
        payment.port.on("payment-error", function(message) {
          showPaymentError(message);
          destroyPaymentRequest();
        });
      } else {
        destroyPaymentRequest();
        // Show miner in case user decided to mine because of insufficient balance
        if (message.response == 'mine') {
          panel.show({ position : button });
          button.state('window', { checked : true });
          panel.port.emit("show-miner", JSON.stringify({ server : server }));
        }
      }
    }); 
  });
  // Purchase request connection error
  payment.port.on("payment-connection-error", function() {
    notify("Connection error! Could not connect to: "+server);
  });
}

// Create a payment request
function createPaymentRequest(server, type, itemID) {
  destroyPaymentRequest();
  payment = require("sdk/page-worker").Page({
    contentScriptFile    : [
      self.data.url("../lib/Payment.js"),
      self.data.url("../lib/WISchnorrClient.js"), 
      self.data.url("../lib/moment.js"), 
      self.data.url("../lib/jsbn.js")
    ],
    contentScriptOptions : {
      server : server,
      type   : type,
      itemID : itemID
    }
  });
  return payment;
}

// Create a new miner
function createNewMiner(job, server, threads, donate) {
  var miner = require("sdk/page-worker").Page({
    contentScriptFile: [
        self.data.url("../lib/Miner.js"), 
        self.data.url("../lib/WISchnorrClient.js"), 
        self.data.url("../lib/moment.js"), 
        self.data.url("../lib/jsbn.js"),
        self.data.url("../lib/RingBuffer.js")
      ],
    contentScriptOptions: {
      debug      : true,
      server     : server,
      threads    : threads,
      donate     : donate,
      workers    : {
        "worker"       : self.data.load("../lib/Worker.js"),
        "ethashWorker" : self.data.load("../lib/EthashWorker.js")
      },
      algorithms : {
        "scrypt"    : self.data.load("../lib/algorithms/scrypt.asm.js"), 
        "neoscrypt" : self.data.load("../lib/algorithms/neoscrypt.asm.js"),
        "ethash"    : self.data.load("../lib/algorithms/ethash.js"),
        "sha256"    : self.data.load("../lib/algorithms/sha256.js")
      }
    }
  });
  // Set Ethash client type (light or full)
  miner.port.emit("set-ethash-client", sp.prefs.ethashClient);
  // Listen to miner status updates...
  miner.port.on("miner-notification-status", function(status) {
    updateMinerStatus(job, status);
  });
  // Listen to new algorithm updates
  miner.port.on("miner-notification-algorithm", function(algorithm) {
  updateMinerAlgorithm(job, algorithm);
  });
  // Listen to new difficulty updates
  miner.port.on("miner-notification-difficulty", function(difficulty) {
    updateMinerDifficulty(job, difficulty);
  });
  // Listen to miner hashrate updates
  miner.port.on("miner-notification-hashrate", function(hashRate) {
    updateMinerHashRate(job, hashRate);
  });
  // Listen to miner average hashrate updates
  miner.port.on("miner-notification-average-hashrate", function(avgHashRate) {
    updateMinerAverageHashRate(job, avgHashRate);
  });
  // Listen to duration updates
  miner.port.on("miner-notification-duration", function(duration) {
    updateMinerDuration(job, duration);
  });
  // Listen to submitted share updates 
  miner.port.on("miner-notification-share-submitted", function(submittedShares) {
    updateMinerSubmittedShares(job, submittedShares);
  });
  // Listen to accepted share updates
  miner.port.on("miner-notification-share-accepted", function(acceptedShares) {
    updateMinerAcceptedShares(job, acceptedShares);
  });
  // Listen to rejected share updates
  miner.port.on("miner-notification-share-rejected", function(rejectedShares) {
    updateMinerRejectedShares(job, rejectedShares);
  });
  // Listen to new ticket updates
  miner.port.on("new-ticket", function(ticket) {
    storeNewTicket(ticket);
    updateMinerAmount(job, ticket.info.value);
  });
  // Listen to new donation updates
  miner.port.on("new-donation", function(amount) {
    updateMinerAmount(job, amount);
  });
  // Load Ethash data
  miner.port.on("load-ethash-data", function(filename) {
    var file = OS.Path.join("ethash", filename);
    // Read data from file
    var promise = OS.File.read(file); 
    promise = promise.then(
      function success(array) {
        // Decode the array to a string 
        var data = new Uint16Array(array.buffer);
        var decodedString = ""; for (var i = 0, e = data.length; i < e; ++i) decodedString += String.fromCharCode(data[i]);
        miner.port.emit("load-ethash-data", decodedString);     
      }, 
      function failure(error) {
        miner.port.emit("load-ethash-data", null);
    });
  });
  // Store Ethash data
  miner.port.on("store-ethash-data", function(ethashData) {
    var file = OS.Path.join("ethash", ethashData.filename);
    // Encode the received data back to an array
    var data = new Uint16Array(new ArrayBuffer(ethashData.decoding.length * 2));
    for (var i = 0, e = ethashData.decoding.length; i < e; ++i) data[i] = ethashData.decoding.charCodeAt(i);
    // Create ethash folder if non-exisiting
    OS.File.makeDir("ethash", { ignoreExisting : false });
    // Write data to file
    var promise = OS.File.writeAtomic(file, data);
    promise.then(null, function(e) { notify("Error storing ethash cache: "+e); });
  });
  return miner;
}

// Destroy and free up the memory of the current payment request
function destroyPaymentRequest() {
  if (payment) {
    payment.destroy();
    payment = null;
  }
}

// Notify the user about a payment error that occured
function showPaymentError(message) {
  switch (message) {
    case 0: 
      notify("Error: One or more tickets have already been spent!");
      break;
    case 1: 
      notify("Error: One or more tickets may have already expired!");
      break;
    case 2: 
      notify("Error: One or more ticket signatures are not valid!");
      break;
    case 3: 
      notify("Error: Amount of submitted tickets is not sufficient!");
      break;
    case 4:
      notify("Error: One or more tickets are not of the same origin!");
      break;
    case 5:
      notify("Error: Return ticket is not valid!");
      break;
    default:
      notify("An unkown error occured during the payment process!");
      break;
  } 
}

// Store a newly generated ticket and notify the UI
function storeNewTicket(ticket) {
  ss.storage.tickets.push(ticket);
  panel.port.emit("new-ticket", { ticket : ticket });
}

// Get a list of tickets based on an amount
function getTickets(origin, amount) {
  // Order tickets based on their expiration date (smaller expiration date first)
  ss.storage.tickets = ss.storage.tickets.sort(function compare(a, b) {
    if (a.info.expiration < b.info.expiration)
      return -1;
    if (a.info.expiration > b.info.expiration)
      return 1;
    return 0;
  });
  // Gather the first tickets to achieve together the desited amount
  var tickets = [], total = 0.0;
  for (index in ss.storage.tickets) {
    var ticket = ss.storage.tickets[index];
    if (ticket.origin.indexOf(origin) != -1 && Date.now() <= (ticket.info.expiration * 1000)) {
      total += parseFloat(ticket.info.value);
      tickets.push(ticket);
    }
    if (total >= parseFloat(amount)) {
      break;
    }
  }
  return tickets;
}

// Delete a list of tickets from local storage
function deleteTickets(tickets) {
  for (var i in tickets) {
    for (var j in ss.storage.tickets) {
      if (tickets[i].info.hash == ss.storage.tickets[j].info.hash) {
        ss.storage.tickets.splice(j, 1);
        break;
      }
    }
  }
  // Inform the UI about the deleted tickets
  panel.port.emit("remove-tickets", { tickets : tickets });
}

// Get the current balance for a specific website
function getBalance(origin) {
  var balance = 0.0;
  for (index in ss.storage.tickets) {
    var ticket = ss.storage.tickets[index];
    if (ticket.origin.indexOf(origin) != -1 && Date.now() <= (ticket.info.expiration * 1000)) {
      balance += ticket.info.value;
    }
  }
  return balance;
}

// Get the number of current active jobs
function getActiveJobs() {
  var activeJobs = 0;
  for (var index in ss.storage.jobs) {
    var job = ss.storage.jobs[index];
    if (job.status != 'Stopped' && job.status != 'Connection Error' && job.status != 'Not running') {
      activeJobs++;
    }
  }
  return activeJobs;
}

// Update the job and the UI concerning the new status
function updateMinerStatus(job, status) {
  job.status = status; job.hashRate = 0;
  button.badge = getActiveJobs();
  button.badgeColor = ((getActiveJobs() == 0) ? "#1977B1" : "#4CAF50");  
  panel.port.emit("miner-notification-status", { id : job.id, status : status });
}

// Update the job and the UI concerning the new algorithm
function updateMinerAlgorithm(job, algorithm) {
  job.algorithm = algorithm;
  panel.port.emit("miner-notification-algorithm", { id : job.id, algorithm : algorithm });
}

// Update the job and the UI concerning the new difficulty  
function updateMinerDifficulty(job, difficulty) {
  job.difficulty = difficulty;
  panel.port.emit("miner-notification-difficulty", { id : job.id, difficulty : difficulty });
}

// Update the job and the UI concerning the new hashrate
function updateMinerHashRate(job, hashRate) {
  job.hashRate = hashRate;
  for (var i = 0; i < job.hashRateQueue.length-1; i++) {
      job.hashRateQueue[i] = job.hashRateQueue[i+1];
  }
  job.hashRateQueue[job.hashRateQueue.length-1] = hashRate;
  panel.port.emit("miner-notification-hashrate", { id : job.id, hashRate : hashRate });
}

// Update the job and the UI concerning the new average hashrate
function updateMinerAverageHashRate(job, avgHashRate) {
  job.avgHashRate = avgHashRate;
  panel.port.emit("miner-notification-average-hashrate", { id : job.id, avgHashRate : avgHashRate });
}
 
// Update the job and the UI concerning the new duration 
function updateMinerDuration(job, duration) {
  job.duration = duration;
  panel.port.emit("miner-notification-duration", { id : job.id, duration : duration });
}

// Update the job and the UI concerning the new submitted share
function updateMinerSubmittedShares(job, submittedShares) {
  if (submittedShares > job.submittedShares) {
    job.submittedShares = submittedShares;
  } else {
    job.submittedShares++;
  }
  panel.port.emit("miner-notification-share-submitted", { id : job.id, submittedShares : job.submittedShares });
  notify("New share found for "+getHostName(job.server)+"!");
}

// Update the job and the UI concerning the new accepted share
function updateMinerAcceptedShares(job, acceptedShares) {
  if (acceptedShares > job.acceptedShares) { 
    job.acceptedShares = acceptedShares;
  } else {
    job.acceptedShares++;
  }
  panel.port.emit("miner-notification-share-accepted", { id : job.id, acceptedShares : job.acceptedShares });
}

// Update the job and the UI concerning the new rejected share
function updateMinerRejectedShares(job, rejectedShares) {
  if (rejectedShares > job.rejectedShares) {
    job.rejectedShares = rejectedShares;
  } else {
    job.rejectedShares++;
  } 
  panel.port.emit("miner-notification-share-rejected", { id : job.id, rejectedShares : job.rejectedShares });
}

// Update the job and the UI concerning the new amount
function updateMinerAmount(job, amount) {
  job.amount += amount;
  panel.port.emit("miner-notification-amount", { id : job.id, amount : job.amount });
}

// Show a notification message to the user
function notify(message) {
  if (sp.prefs.notifications) {
    notifications.notify({
      title   : "TicketMiner",
      text    : message,
      iconURL : button_icons[32]
    });
  }
}
