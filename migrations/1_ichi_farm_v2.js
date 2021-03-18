const ichiFarm = artifacts.require("ichiFarmV2");
var ichiPerBlock = 5000000000;
var ICHI = "0x903bef1736cddf2a537176cf3c64579c3867a881"; //ICHI

module.exports = async function(deployer) {
  const d_ichiFarm = await deployer.deploy(ichiFarm,ICHI,ichiPerBlock);
}
