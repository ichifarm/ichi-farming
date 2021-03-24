module.exports = async function ({ getNamedAccounts, deployments }) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()
  const chainId = await getChainId()


    if (chainId != 1) {
      await deploy("Ichi", {
        from: deployer,
        log: true,
        deterministicDeployment: false
      })
    }
    

  
}

module.exports.tags = ["ICHI"]
