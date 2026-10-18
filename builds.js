/* eBikePartsPicker builds — featured builds + build guides.
   parts reference CATEGORIES by {cat, opt} index into data.js.
   "Copy this build" loads them straight into the builder. */

var BUILDS = [
  {
    owner: 'Josh',
    bike: 'ventus-plus',
    title: 'Josh\u2019s Ventus One Plus build',
    blurb: 'Full EXT suspension, Warp 9 wheels and pegs, VTB controller.',
    pids: ['warp9-1619','ext-ferro','ext-arma-mx','vtb-aetos','ventus-graphics','warp9-pegs-lbx-ventus']
  }
];

/* Build guides (Oct 18, 2026): Budget / Smart money / Dream for the most popular bikes.
 Parts are referenced by pid. A guide only renders when EVERY part is a Confirmed fit
 for that bike and has a retailer-checked price (see guideIssues in app.js). */
var GUIDES = [
  {bike:"ultrabee", tier:"budget", name:"Budget build", blurb:"Bolt-on basics for the Ultra Bee.",
   pids:["pegs-kke-ultrabee", "guts-seat-cover", "guards-ultrabee-skid"],
   pros:["All three parts are listed for the Ultra Bee by the seller", "Bolt-on: no wiring or tuning"],
   cons:["Ride feel is unchanged: stock suspension and power", "The Guts cover is made to order, so expect a wait"]},
  {bike:"ultrabee", tier:"smart", name:"Smart money build", blurb:"Matched RFLOXA suspension front and rear.",
   pids:["rfloxa-ultra43", "rfloxa-raf55rv-ultrabee", "pegs-kke-ultrabee", "guards-ultrabee-skid"],
   pros:["Fork and shock are both listed specifically for the Ultra Bee", "Seller lists spring options by rider weight"],
   cons:["Suspension needs setup: pick the right spring for your weight", "Stock powertrain: power upgrades are in the builder"]},
  {bike:"ultrabee", tier:"dream", name:"Dream build", blurb:"Full Sirris suspension, 18/21 wheels and titanium hardware.",
   pids:["sirris-f43-ultra-bee", "sirris-r46-ultrabee", "ion-18-21-ultrabee", "warp9-chassis-kit-ultrabee", "pegs-kke-ultrabee", "guts-seat-cover"],
   pros:["Sirris fork and shock are both made for the Ultra Bee", "18/21 wheels open up full-size dirt bike tire choices"],
   cons:["The most expensive option here", "Check whether tires come with the wheelset before ordering"],
   power:"ultrabee"},
  {bike:"lightbee", tier:"budget", name:"Budget build", blurb:"Comfort and control for under $200.",
   pids:["warp9-3in-rise", "seat-guts-lightbee-cover", "charged-brake-pads-emoto"],
   pros:["Every part is listed for the Light Bee by the seller", "Bolt-on: no wiring or tuning"],
   cons:["Stock suspension and power"]},
  {bike:"lightbee", tier:"smart", name:"Smart money build", blurb:"Upgrade the front end with a fork kit KKE lists for the Light Bee.",
   pids:["kke-37mm-fork-kit", "warp9-3in-rise", "seat-guts-lightbee-cover", "charged-brake-pads-emoto"],
   pros:["KKE lists the 37mm fork kit for the Sur-Ron Light Bee", "Keeps the comfort parts from the budget build"],
   cons:["Rear shock stays stock, so front and rear won't feel matched", "Stock powertrain"]},
  {bike:"lightbee", tier:"dream", name:"Dream build", blurb:"Sirris fork, EXT Arma shock and a 16/19 wheel kit.",
   pids:["sirris-f43-cmx-light-bee", "ext-arma-mx", "wheels-kke-lightbee-16-19", "warp9-3in-rise", "seat-guts-lightbee-cover"],
   pros:["Sirris fork and EXT Arma shock are both listed for the Light Bee", "16/19 wheel kit is made for the Light Bee"],
   cons:["The most expensive option here", "Check whether tires come with the wheel kit", "Stock powertrain: power upgrades are in the builder"]},
  {bike:"mx4", tier:"budget", name:"Budget build", blurb:"New bars, a fresh wrap and new brake pads for about $200.",
   pids:["warp9-3in-rise", "ecd-wrap-talaria-solid", "charged-brake-pads-emoto"],
   pros:["Every part is listed for the Talaria Sting by the seller", "Bolt-on"],
   cons:["Stock suspension and power"]},
  {bike:"mx4", tier:"smart", name:"Smart money build", blurb:"Upgrade the front end with a fork kit KKE lists for the MX4.",
   pids:["kke-37mm-fork-kit", "warp9-3in-rise", "ecd-wrap-talaria-solid", "charged-brake-pads-emoto"],
   pros:["KKE lists the 37mm fork kit for the Talaria Sting MX3/MX4", "Keeps the budget-build parts"],
   cons:["Rear shock stays stock", "Stock powertrain"]},
  {bike:"mx4", tier:"dream", name:"Dream build", blurb:"Front and rear suspension plus a full titanium bolt kit.",
   pids:["kke-37mm-fork-kit", "ext-arma-mx", "mxbolts-talaria-kit", "warp9-3in-rise", "ecd-wrap-talaria-solid"],
   pros:["EXT lists the Arma MX shock for the Talaria MX4", "MXBolts kit is made for the Talaria Sting MX"],
   cons:["Uses the KKE fork kit: the EXT Ferro needs a hub boost spacer on the MX4"],
   power:"mx4"},
];

/* Power upgrades page: one sourced motor/controller/battery combo per bike.
   Same publishing gate as the guides (every part Confirmed fit + checked price). */
var POWER = [
  {bike:"ultrabee", title:"VTB powertrain",
   pids:["vtb-41kw-ultra-bee", "vtb-aetos-pro", "vtb-aetos-gen2-harness-kit", "dhs-72v-65ah-ub"],
   why:["Every listing names the Ultra Bee","The VTB 41kW motor listing says it pairs with the VTB V9600 controller (Aetos Pro is the V9600 Gen.2)","DHS battery is 72V / 20s (84V full), inside the Aetos Pro\u2019s 12s\u201322s range, and its plug works with OEM or upgraded controllers","The Aetos Pro needs the bike-specific Gen.2 harness, included here"],
   watch:["Controller, harness and motor swap is a real wiring job: budget for install time or a shop"]},
  {bike:"mx4", title:"EBMX + eWatt 72V powertrain",
   pids:["ebmx-xta-60", "ebmx-x9000-v3-kit-talaria", "ewatt-72v-63ah-t", "ccw-fast-charger-72v-15a"],
   why:["eWatt\u2019s listing recommends exactly this pairing for the Talaria MX3/MX4/MX5: X-9000 controller + XTA-60 motor","XTA-60 includes MX3/MX4 mounting hardware; the X-9000 V3 kit is the Talaria MX3/MX4/MX5 harness version","72V charger included: the OEM 60V charger won\u2019t work with the eWatt battery"],
   watch:["The battery needs a taller seat lid (included with the battery)","Controller and motor swap is a real wiring job"]}
];
