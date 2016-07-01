/** 
  -- MiningProfitablityCalculator.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

var request = require("request");
var cheerio = require("cheerio");

// Initialize MiningProfitablityCalculator
function MiningProfitabilityCalculator() {}

// Get the current conversion rate from Bitcoin to a fiat currency
MiningProfitabilityCalculator.prototype.getConversionRate = function(currency, callback) {
	// Connect to the API of coindesk and get the current price as json
	request("https://api.coindesk.com/v1/bpi/currentprice.json", function (error, response, body) {
	  	if (!error) {
	  		var currentprice = JSON.parse(body);
	  		// Get the current price for the given currency
	  		callback(currentprice.bpi[currency].rate_float);
	  	}
	});
};	

// Get the most profitable coin based on the given hashrates, coins and exchange
MiningProfitabilityCalculator.prototype.getMostProfitableCoin = function(hashrates, coins, exchange, callback) {
	// Create the query to connect to the coinwarz mining profitability calculator
	var query = "http://www.coinwarz.com/cryptocurrency/?";
	for (var i in hashrates) {
	  query += hashrates[i].algorithm+'hr='+hashrates[i].default_hashrate+'&'+hashrates[i].algorithm+'p=0.00&'+hashrates[i].algorithm+'pc=0.00&'+hashrates[i].algorithm+'c=true';
	}
	query += "&e="+exchange;
	// Request the query
	request(query, function (error, response, body) {
	  	if (!error) {
		    var $ = cheerio.load(body);
		    var found = false;
		    // Loop through the list of most profitable coins
		    $('#tblCoins tr').each(function (i, row) {
		      	var $row = $(row);
		      	// Get the coin symbol
		      	var coin_symbol = $row.find('.link').text().substring($row.find('.link').text().indexOf('(')+1, $row.find('.link').text().indexOf(')'));
		      	// Get the block reward
		      	var block_reward = $row.find('div[style="width: 164px; font-size: 7.5pt; height: 11px;"]').text().replace(/\s/g, '').replace('BlockReward:', '');
		      	// Get the block difficulty
		      	var block_difficulty = $row.find('div[style="width: 140px; text-align: center;"]').text().replace(/\s/g, '').replace(new RegExp(',', 'g'), '');;
		      	// Get the coin converstion rate to Bitcoin
		      	var coin_rate = $row.find('.link').text().substring($row.find('.link').text().indexOf(')')+1, $row.find('.link').text().length);
		      	if (!found) {
		      		// Loop through the list of our available coins
			      	for (var i in coins) {
			      		// Return the first coin in our list which is most profitable according to the coinwarz mining profitability calculator
			      		if (coins[i].coin_symbol == coin_symbol) {
				      	  	found = true;
				      	  	callback(block_reward, block_difficulty, coin_rate, coins[i]);
				          	break;
			        	}
			      	}
		  		}
		    });
	  	}
	});
};

module.exports = MiningProfitabilityCalculator;
