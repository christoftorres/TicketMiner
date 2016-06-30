/** 
  -- WISchnorrClient.js -- 
  Author : Christof Torres <christof.ferreira.001@student.uni.lu>
  Date   : June 2016
**/

/* Initializes the WISchnorClient based on a given public key */
function WISchnorrClient(publicKey) {
	// Discrete logarithm parameters
	this.p = new BigInteger(publicKey.p);
	this.q = new BigInteger(publicKey.q);
	this.g = new BigInteger(publicKey.g);
	// Public key
	this.y = new BigInteger(publicKey.y);
}

/* Generates a cryptographically secure random number modulo q */
WISchnorrClient.prototype.GenerateRandomNumber = function() {
	var bytes = Math.floor(Math.random() * ((this.q.bitLength()/8) - 1 + 1)) + 1;
	var array = new Uint32Array(bytes);
    window.crypto.getRandomValues(array);
    var randomBytes = '';
    for (var i = 0; i < array.length; i++) {
    	randomBytes += array[i];
    }
    return new BigInteger(randomBytes).mod(this.q);
};

/* Generates a challenge 'e' for the server */
WISchnorrClient.prototype.GenerateWISchnorrClientChallenge = function(params, info, msg) {
    var t1 = this.GenerateRandomNumber();
	var t2 = this.GenerateRandomNumber();
	var t3 = this.GenerateRandomNumber();
	var t4 = this.GenerateRandomNumber();
	
	var F = CryptoJS.SHA256(info);
    // z = F^((p-1)/q) mod p
	var z = new BigInteger(F.toString(), 16).modPow(this.p.subtract(new BigInteger("1")).divide(this.q), this.p);
	
	// alpha = a * g^t1 * y^t2
	var a = new BigInteger(params.a);
	var alpha = a.multiply(this.g.modPow(t1, this.p)).multiply(this.y.modPow(t2, this.p)).mod(this.p);
	
	// beta = b * g^t3 * z^t4
	var b = new BigInteger(params.b);
	var beta = b.multiply(this.g.modPow(t3, this.p)).multiply(z.modPow(t4, this.p)).mod(this.p);

	var H = CryptoJS.SHA256(alpha.toString()+beta.toString()+z.toString()+msg);
    // epsilon = H mod q
	var epsilon = new BigInteger(H.toString(), 16).mod(this.q);

	// e = eplison - t2 - t4 mod q
	var e = epsilon.subtract(t2).subtract(t4).mod(this.q);

	return { e : e.toString(), t : { t1 : t1, t2 : t2, t3 : t3, t4 : t4 } };
};

/* Generates a WISchnorr partially blind signature based on the response from the server */
WISchnorrClient.prototype.GenerateWISchnorrBlindSignature = function(challenge, response) {
	// rho = r + t1 mod q
	var r = new BigInteger(response.r);
	var rho = r.add(challenge.t1).mod(this.q);
	
	// omega = c + t2 mod q 
	var c = new BigInteger(response.c);
	var omega = c.add(challenge.t2).mod(this.q);
	
	// sigma = s + t3 mod q
	var s = new BigInteger(response.s);
	var sigma = s.add(challenge.t3).mod(this.q);
	
	// delta = d + t4 mod q
	var d = new BigInteger(response.d);
	var delta = d.add(challenge.t4).mod(this.q);

	return {rho : rho.toString(), omega : omega.toString(), sigma : sigma.toString(), delta : delta.toString()};
};

/* Verifies a WISchnorr partially blind signature */
WISchnorrClient.prototype.VerifyWISchnorrBlindSignature = function(signature, info, msg) {
	var F = CryptoJS.SHA256(info);
    // z = F^((p-1)/q) mod p
	var z = new BigInteger(F.toString(), 16).modPow(this.p.subtract(new BigInteger("1")).divide(this.q), this.p);
	
	// g^rho mod p
	var gp = this.g.modPow(new BigInteger(signature.rho), this.p);
	// y^omega mod p
	var yw = this.y.modPow(new BigInteger(signature.omega), this.p);
	// g^rho * y^omega mod p
	var gpyw = gp.multiply(yw).mod(this.p);

	// g^sigma mod p
	var gs = this.g.modPow(new BigInteger(signature.sigma), this.p);
	// z^delta mod p
	var zd = z.modPow(new BigInteger(signature.delta), this.p);
	// g^sigma * z^delta mod p
	var gszd = gs.multiply(zd).mod(this.p);

	var H = CryptoJS.SHA256(gpyw.toString()+gszd.toString()+z.toString()+msg);
	// hsig = H mod q
	var hsig = new BigInteger(H.toString(), 16).mod(this.q);	

	// vsig = omega + delta mod q
	var vsig = new BigInteger(signature.omega).add(new BigInteger(signature.delta)).mod(this.q);

	if (vsig.compareTo(hsig) === 0) {
		return true;
	} else {
		return false;
	}
};

/*
CryptoJS v3.1.2
code.google.com/p/crypto-js
(c) 2009-2013 by Jeff Mott. All rights reserved.
code.google.com/p/crypto-js/wiki/License
*/
var CryptoJS=CryptoJS||function(h,s){var f={},t=f.lib={},g=function(){},j=t.Base={extend:function(a){g.prototype=this;var c=new g;a&&c.mixIn(a);c.hasOwnProperty("init")||(c.init=function(){c.$super.init.apply(this,arguments)});c.init.prototype=c;c.$super=this;return c},create:function(){var a=this.extend();a.init.apply(a,arguments);return a},init:function(){},mixIn:function(a){for(var c in a)a.hasOwnProperty(c)&&(this[c]=a[c]);a.hasOwnProperty("toString")&&(this.toString=a.toString)},clone:function(){return this.init.prototype.extend(this)}},
q=t.WordArray=j.extend({init:function(a,c){a=this.words=a||[];this.sigBytes=c!=s?c:4*a.length},toString:function(a){return(a||u).stringify(this)},concat:function(a){var c=this.words,d=a.words,b=this.sigBytes;a=a.sigBytes;this.clamp();if(b%4)for(var e=0;e<a;e++)c[b+e>>>2]|=(d[e>>>2]>>>24-8*(e%4)&255)<<24-8*((b+e)%4);else if(65535<d.length)for(e=0;e<a;e+=4)c[b+e>>>2]=d[e>>>2];else c.push.apply(c,d);this.sigBytes+=a;return this},clamp:function(){var a=this.words,c=this.sigBytes;a[c>>>2]&=4294967295<<
32-8*(c%4);a.length=h.ceil(c/4)},clone:function(){var a=j.clone.call(this);a.words=this.words.slice(0);return a},random:function(a){for(var c=[],d=0;d<a;d+=4)c.push(4294967296*h.random()|0);return new q.init(c,a)}}),v=f.enc={},u=v.Hex={stringify:function(a){var c=a.words;a=a.sigBytes;for(var d=[],b=0;b<a;b++){var e=c[b>>>2]>>>24-8*(b%4)&255;d.push((e>>>4).toString(16));d.push((e&15).toString(16))}return d.join("")},parse:function(a){for(var c=a.length,d=[],b=0;b<c;b+=2)d[b>>>3]|=parseInt(a.substr(b,
2),16)<<24-4*(b%8);return new q.init(d,c/2)}},k=v.Latin1={stringify:function(a){var c=a.words;a=a.sigBytes;for(var d=[],b=0;b<a;b++)d.push(String.fromCharCode(c[b>>>2]>>>24-8*(b%4)&255));return d.join("")},parse:function(a){for(var c=a.length,d=[],b=0;b<c;b++)d[b>>>2]|=(a.charCodeAt(b)&255)<<24-8*(b%4);return new q.init(d,c)}},l=v.Utf8={stringify:function(a){try{return decodeURIComponent(escape(k.stringify(a)))}catch(c){throw Error("Malformed UTF-8 data");}},parse:function(a){return k.parse(unescape(encodeURIComponent(a)))}},
x=t.BufferedBlockAlgorithm=j.extend({reset:function(){this._data=new q.init;this._nDataBytes=0},_append:function(a){"string"==typeof a&&(a=l.parse(a));this._data.concat(a);this._nDataBytes+=a.sigBytes},_process:function(a){var c=this._data,d=c.words,b=c.sigBytes,e=this.blockSize,f=b/(4*e),f=a?h.ceil(f):h.max((f|0)-this._minBufferSize,0);a=f*e;b=h.min(4*a,b);if(a){for(var m=0;m<a;m+=e)this._doProcessBlock(d,m);m=d.splice(0,a);c.sigBytes-=b}return new q.init(m,b)},clone:function(){var a=j.clone.call(this);
a._data=this._data.clone();return a},_minBufferSize:0});t.Hasher=x.extend({cfg:j.extend(),init:function(a){this.cfg=this.cfg.extend(a);this.reset()},reset:function(){x.reset.call(this);this._doReset()},update:function(a){this._append(a);this._process();return this},finalize:function(a){a&&this._append(a);return this._doFinalize()},blockSize:16,_createHelper:function(a){return function(c,d){return(new a.init(d)).finalize(c)}},_createHmacHelper:function(a){return function(c,d){return(new w.HMAC.init(a,
d)).finalize(c)}}});var w=f.algo={};return f}(Math);
(function(h){for(var s=CryptoJS,f=s.lib,t=f.WordArray,g=f.Hasher,f=s.algo,j=[],q=[],v=function(a){return 4294967296*(a-(a|0))|0},u=2,k=0;64>k;){var l;a:{l=u;for(var x=h.sqrt(l),w=2;w<=x;w++)if(!(l%w)){l=!1;break a}l=!0}l&&(8>k&&(j[k]=v(h.pow(u,0.5))),q[k]=v(h.pow(u,1/3)),k++);u++}var a=[],f=f.SHA256=g.extend({_doReset:function(){this._hash=new t.init(j.slice(0))},_doProcessBlock:function(c,d){for(var b=this._hash.words,e=b[0],f=b[1],m=b[2],h=b[3],p=b[4],j=b[5],k=b[6],l=b[7],n=0;64>n;n++){if(16>n)a[n]=
c[d+n]|0;else{var r=a[n-15],g=a[n-2];a[n]=((r<<25|r>>>7)^(r<<14|r>>>18)^r>>>3)+a[n-7]+((g<<15|g>>>17)^(g<<13|g>>>19)^g>>>10)+a[n-16]}r=l+((p<<26|p>>>6)^(p<<21|p>>>11)^(p<<7|p>>>25))+(p&j^~p&k)+q[n]+a[n];g=((e<<30|e>>>2)^(e<<19|e>>>13)^(e<<10|e>>>22))+(e&f^e&m^f&m);l=k;k=j;j=p;p=h+r|0;h=m;m=f;f=e;e=r+g|0}b[0]=b[0]+e|0;b[1]=b[1]+f|0;b[2]=b[2]+m|0;b[3]=b[3]+h|0;b[4]=b[4]+p|0;b[5]=b[5]+j|0;b[6]=b[6]+k|0;b[7]=b[7]+l|0},_doFinalize:function(){var a=this._data,d=a.words,b=8*this._nDataBytes,e=8*a.sigBytes;
d[e>>>5]|=128<<24-e%32;d[(e+64>>>9<<4)+14]=h.floor(b/4294967296);d[(e+64>>>9<<4)+15]=b;a.sigBytes=4*d.length;this._process();return this._hash},clone:function(){var a=g.clone.call(this);a._hash=this._hash.clone();return a}});s.SHA256=g._createHelper(f);s.HmacSHA256=g._createHmacHelper(f)})(Math);
