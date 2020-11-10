# How Staking Works

# Blockrank = # of LP tokens (sorted)

# Rewards = looping through last block number to now
# each loop, find factors < total number of players (using sqrt)
# loop to a max number, "X", of block * players (let's say 1000) and then truncate
# each block, take 1 and divide it by the number of factors (this is the reward per player)
#             then, add it to the player's tree-index (everyone starts at 0)
# key = ethereum address, val = LP tokens
# mapping (address => uint256) public rewards (keeps track of total gov rewards tokens per address)

# ==== Payout Mechanisms ==== 

run the loop above

* when a user stakes more, we remove their existing key and then re-insert key with new LP value
* when a user unstakes a little, we do the same
* when a user unstakes completely, we remove their existing key
* when a user stakes for the first time, we add their key

# And then -> we pay out their current public rewards and set it to 0


player 1
player 2
player 3
player 4