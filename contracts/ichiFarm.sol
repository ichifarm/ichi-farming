pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFactor {
    function getFactorList(uint256 key) external view returns (uint256[] memory);       // get factor list
    function populateFactors(uint256 startingKey, uint256 endingKey) external;          // add new factors
}

// deposit ichiLP tokens to farm ICHI
contract ichiFarm is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using HitchensList for HitchensList.Tree;

    //   pending reward = (user.amount * pool.accIchiPerShare) - user.rewardDebt
    //   Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
    //   1. The pool's `accIchiPerShare` (and `lastRewardBlock`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `amount` gets updated.
    //   4. User's `rewardDebt` gets updated.

    struct UserInfo {
        uint256 amount;                                                 // How many LP tokens the user has provided.
        uint256 rewardDebt;                                             // Reward debt. See explanation below.
        uint256 bonusReward;                                            // Bonous Reward Tokens
    }
                                                                        // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken;                                                 // Address of LP token contract.
        uint256 allocPoint;                                             // How many allocation points assigned to this pool. ICHIs to distribute per block.
        uint256 lastRewardBlock;                                        // Last block number that ICHIs distribution occurs.
        uint256 lastRewardBonusBlock;                                   // Last bonus number block
        uint256 accIchiPerShare;                                        // Accumulated ICHIs per share, times 10 ** 9. See below.
        uint256 startBlock;                                             // start block for rewards
        uint256 endBlock;                                               // end block for rewards
        uint256 bonusToRealRatio;                                       // ranges from 0 to 100. 0 = 0% of bonus tokens distributed, 100 = 100% of tokens distributed to bonus
                                                                        // initial val = 50 (50% goes to regular, 50% goes to bonus)

        uint256 maxWinnersPerBlock;                                     // maximum winners per block
        uint256 maxTransactionLoop;                                     // maximimze winners per tx
        uint256 ichiPerLoop;                                            // how much ichi to pay for the user calling updatePool (10 ** 9) / TODO: naming?
        uint256 minerCutoff;                                            // if miners <= this value, decrease the 3 variables above
                                                                        // if miners > this value, increase the 3 variables above
        uint256 gasTank;                                                // amount of ichi in the gas tank (10 ** 9)

        HitchensList.Tree blockRank;                                    // sorted list data structure (red black tree)
    }

    IERC20 public ichi;
    uint256 public ichiPerBlock;                                        // ICHI tokens created per block.

    PoolInfo[] internal poolInfo;                                       // Info of each pool (must be internal for blockRank data structure)
    mapping (uint256 => mapping (address => UserInfo)) public userInfo; // Info of each user that stakes LP tokens.

    uint256 public totalAllocPoint;                                     // Total allocation points. Must be the sum of all allocation points in all pools.

    address public oneFactorContract;                                   // contract address uses to add new factor and get existing factor

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Log(string action, bytes32 key, uint256 value);
    event NewMaxBlock(uint256 maxLoops);
    
    bool nonReentrant;
    mapping (uint256 => uint256) public playersInPool;

    // ============================================================================
    // all initial ICHI circulation initially will be deposited into this ichiFarm contract

    constructor(
        IERC20 _ichi,
        uint256 _ichiPerBlock,
        address _oneFactorContract
    )  
        public
    {
        ichi = _ichi;
        ichiPerBlock = _ichiPerBlock; // 5 => 5*2 = 5,000,000 coins
        totalAllocPoint = 0;
        oneFactorContract = _oneFactorContract;
    }

    function setMaxWinnersPerBlock(uint256 _poolID, uint256 _val) external onlyOwner {
        poolInfo[_poolID].maxWinnersPerBlock = _val;
    }

    function setMaxTransactionLoop(uint256 _poolID, uint256 _val) external onlyOwner {
        poolInfo[_poolID].maxTransactionLoop = _val;
    }

    function setIchiPerLoop(uint256 _poolID, uint256 _val) external onlyOwner {
        poolInfo[_poolID].ichiPerLoop = _val;
    }

    function setMinerCutoff(uint256 _poolID, uint256 _val) external onlyOwner {
        poolInfo[_poolID].minerCutoff = _val;
    }

    function setBonusRealRatio(uint256 _poolID, uint256 _val) external onlyOwner {
        poolInfo[_poolID].bonusToRealRatio = _val;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function setNonReentrant(bool _val) external onlyOwner returns (bool) {
        nonReentrant = _val;
        return nonReentrant;
    }

    function getIchiPerLoop(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].ichiPerLoop;
    }

    function gasTank(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].gasTank;
    }

    function geMaxTransactionLoop(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].maxTransactionLoop;
    }

    function getMaxWinnersPerBlock(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].maxWinnersPerBlock;
    }

    function getBonusToRealRatio(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].bonusToRealRatio;
    }

    function setBonusToRealRatio(uint256 _poolID, uint256 _val) external returns (uint256) {
        poolInfo[_poolID].bonusToRealRatio = _val;
    }

    function setMaxWinnersPerBlock(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].maxWinnersPerBlock;
    }

    function lastRewardsBlock(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].lastRewardBlock;
    }

    function startBlock(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].startBlock;
    }

    function getPoolToken(uint256 _poolID) external view returns (address) {
        return address(poolInfo[_poolID].lpToken);
    }

    function getAllocPoint(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].allocPoint;
    }

    function getAllocPerShare(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].accIchiPerShare;
    }

    function ichiReward(uint256 _poolID) external view returns (uint256) {
        return ichiPerBlock.mul(poolInfo[_poolID].allocPoint).div(totalAllocPoint);
    }

    function getLPSupply(uint256 _poolID) external view returns (uint256) {
        uint256 lpSupply = poolInfo[_poolID].lpToken.balanceOf(address(this));
        return lpSupply;
    }

    function endBlock(uint256 _poolID) external view returns (uint256) {
        return poolInfo[_poolID].endBlock;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate, uint256 _startBlock, uint256 _endBlock)
        public
        onlyOwner
    {
        if (_withUpdate) {
            massUpdatePools();
        }

        totalAllocPoint = totalAllocPoint.add(_allocPoint);

        HitchensList.Tree storage blockRankObject;

        // create pool info
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: _startBlock,
            lastRewardBonusBlock: _startBlock,
            startBlock: _startBlock,
            endBlock: _endBlock,
            bonusToRealRatio: 50,       // 1-1 split of 2 ichi reward per block
            accIchiPerShare: 0,
            maxWinnersPerBlock: 8,      // for good luck
            maxTransactionLoop: 100,    // 100 total winners per update bonus reward
            ichiPerLoop: 10 ** 8,       // 0.1 Ichi per loop
            minerCutoff: 50,
            gasTank: 0,
            blockRank: blockRankObject
        }));
    }

    // Update the given pool's ICHI allocation point. Can only be called by the owner.
    function set(uint256 _poolID, uint256 _allocPoint, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_poolID].allocPoint).add(_allocPoint);
        poolInfo[_poolID].allocPoint = _allocPoint;
    }

    // View function to see pending ICHIs on frontend.
    function pendingIchi(uint256 _poolID, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_poolID];
        UserInfo storage user = userInfo[_poolID][_user];
        uint256 accIchiPerShare = pool.accIchiPerShare;
        uint256 bonusToRealRatio = pool.bonusToRealRatio;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 ichiRewardAmount = ichiPerBlock.mul(pool.allocPoint).div(totalAllocPoint);
            accIchiPerShare = accIchiPerShare.add(ichiRewardAmount.mul(10 ** 18).div(lpSupply)); // 10 ** 18 to match the LP supply
        }
        return user.amount.mul(accIchiPerShare).div(10 ** 9).sub(user.rewardDebt).mul(uint256(100).sub(bonusToRealRatio)).div(50);
    }

    // View bonus Ichi
    function pendingBonusIchi(uint256 _poolID, address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_poolID][_user];
        uint256 bonusToRealRatio = poolInfo[_poolID].bonusToRealRatio;
        return user.bonusReward.mul(bonusToRealRatio).div(50);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    // also run bonus rewards calculations
    function updatePool(uint256 _poolID) public {
        PoolInfo storage pool = poolInfo[_poolID];

        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        // must be within end block
        if (block.number <= pool.endBlock) {
            uint256 ichiRewardAmount = ichiPerBlock.mul(pool.allocPoint).div(totalAllocPoint);
            pool.accIchiPerShare = pool.accIchiPerShare.add(ichiRewardAmount.mul(10 ** 18).div(lpSupply)); // 10 ** 18 to match LP supply
            pool.lastRewardBlock = block.number;
        }
    }

    // separate function to call by the public
    function updateBonusRewards(uint256 _poolID)
        public
    {
        require(!nonReentrant, "ichiFarm::nonReentrant - try again");
        nonReentrant = true;

        PoolInfo storage pool = poolInfo[_poolID];

        if (block.number <= pool.lastRewardBonusBlock) {
            return;
        }

        uint256 lastRewardBlock = pool.lastRewardBonusBlock;

        // run bonus rewards calculations
        uint256 totalMinersInPool = playersInPool[_poolID];

        // increment this to see if it hits the max
        uint256 totalWinnersPerTX = 0;
        for (uint256 blockIter = lastRewardBlock; blockIter < block.number; ++blockIter) { // block.number

            uint256 cutoff = findBlockNumberCutoff(totalMinersInPool, blockIter);

            // add factor list if not found
            if (IFactor(oneFactorContract).getFactorList(cutoff).length == 0) {
                IFactor(oneFactorContract).populateFactors(cutoff, cutoff.add(1));  
            }

            cutoff = cutoff == 0 ? 1 : cutoff;

            // rank factors in the block number
            uint256[] memory factors = IFactor(oneFactorContract).getFactorList(cutoff);
            uint256 extraFactors = ((totalMinersInPool.sub(totalMinersInPool.mod(cutoff))).div(cutoff)).sub(1);

            uint256 currentBlockWinners = factors.length.add(extraFactors);                // total winners
            uint256 rewardPerWinner = uint256(10 ** 9).div(currentBlockWinners);           // assume 10 ** 9 = 1 ICHI token

            // keep winners payout to less than the max transaction loop size
            if (totalWinnersPerTX.add(currentBlockWinners) > pool.maxTransactionLoop) {
                uint256 unpaidBlocks = block.number.sub(blockIter);     // pay gasTank for unpaid blocks
                pool.gasTank = pool.gasTank.add(unpaidBlocks);          // one ICHI!
                break;
            }

            // save to gasTank
            if (currentBlockWinners > pool.maxWinnersPerBlock) {
                pool.gasTank = pool.gasTank.add(10 ** 9); // one ICHI!
                totalWinnersPerTX = totalWinnersPerTX.add(1);
            } else {
                updateBonusRewardsHelper(factors, _poolID, rewardPerWinner, cutoff, totalMinersInPool);
                totalWinnersPerTX = totalWinnersPerTX.add(currentBlockWinners); // add winners
            }
        }

        uint256 ichiToPayCaller = totalWinnersPerTX.mul(pool.ichiPerLoop) <= pool.gasTank ? totalWinnersPerTX.mul(pool.ichiPerLoop) : pool.gasTank;

        if (ichiToPayCaller != 0) {
            safeIchiTransfer(msg.sender, ichiToPayCaller);              // send ichi to caller
            pool.gasTank = pool.gasTank.sub(ichiToPayCaller);           // update gas tank
        }

        // update new variables based on the number of farmers paid
        if (totalWinnersPerTX <= pool.minerCutoff) {
            if (pool.maxWinnersPerBlock > 2) pool.maxWinnersPerBlock = pool.maxWinnersPerBlock.sub(1);
            if (pool.maxWinnersPerBlock > 20) pool.maxTransactionLoop = pool.maxTransactionLoop.sub(1);
            pool.ichiPerLoop = pool.ichiPerLoop.sub(pool.ichiPerLoop.mul(5 * 10 ** 6).div(10 ** 9)); // 0.5%
        } else {
            if (pool.maxWinnersPerBlock < 25) pool.maxWinnersPerBlock = pool.maxWinnersPerBlock.add(1);
            if (pool.maxTransactionLoop < 350) pool.maxTransactionLoop = pool.maxTransactionLoop.add(1);
            pool.ichiPerLoop = pool.ichiPerLoop.add(pool.ichiPerLoop.mul(5 * 10 ** 6).div(10 ** 9)); // 0.5%
        }

        // update the last block.number for bonus
        pool.lastRewardBonusBlock = block.number;
        nonReentrant = false;
    }

    // loop through winners and update their keys
    function updateBonusRewardsHelper(
        uint256[] memory factors,
        uint256 _poolID,
        uint256 rewardPerWinner,
        uint256 cutoff,
        uint256 totalMinersInPool
    ) private {
        // loop through factors and factors2 and add `rewardPerWinner` to each
        for (uint256 i = 0; i < factors.length; ++i) {
            // factor cannot be last node
            if (factors[i] != totalMinersInPool) {
                uint256 value = valueAtRank(_poolID, factors[i]);
                address key = getValueKey(_poolID, value, 0);
                userInfo[_poolID][key].bonusReward = userInfo[_poolID][key].bonusReward.add(rewardPerWinner);
            }
        }

        // increment to next
        uint256 startingCutoff = cutoff.add(cutoff);

        for (uint256 j = startingCutoff; j < totalMinersInPool; j.add(cutoff)) {
            // value cannot be last node
            if (j != totalMinersInPool) {
                uint256 value = valueAtRank(_poolID, j);
                address key = getValueKey(_poolID, value, 0);
                userInfo[_poolID][key].bonusReward = userInfo[_poolID][key].bonusReward.add(rewardPerWinner);
            }
        }
    }

    // Deposit LP tokens to ichiFarm for ICHI allocation.
    // call ichiFactor function (add if not enough)
    function deposit(uint256 _poolID, uint256 _amount) public {
        require(!nonReentrant, "ichiFarm::nonReentrant - try again");
        nonReentrant = true;

        PoolInfo storage pool = poolInfo[_poolID];
        UserInfo storage user = userInfo[_poolID][msg.sender];

        if (user.amount > 0) {
            uint256 pending = user.amount.mul(pool.accIchiPerShare).div(10 ** 9).sub(user.rewardDebt);

            if (pending > 0) {
                safeIchiTransfer(msg.sender, pending);
            }

            if (user.bonusReward > 0) {
                safeIchiTransfer(msg.sender, user.bonusReward);
            }
        }

        if (_amount > 0) {
            // if key exists, remove and re add
            require(!valueExists(_poolID, user.amount.add(_amount)), "ichiFarm::LP collision - please try a different LP amount");
            require(pool.lpToken.balanceOf(msg.sender) >= _amount, "insufficient LP balance");

            if (keyValueExists(_poolID, bytes32(uint256(msg.sender)), user.amount)) {
                removeKeyValue(_poolID, bytes32(uint256(msg.sender)), user.amount);
                playersInPool[_poolID] = playersInPool[_poolID].sub(1);
            }

            pool.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
            user.amount = user.amount.add(_amount);

            playersInPool[_poolID] = playersInPool[_poolID].add(1);

            insertKeyValue(_poolID, bytes32(uint256(msg.sender)), user.amount);
        }

        // calculate the new total miners after this deposit
        uint256 totalMinersInPool = playersInPool[_poolID];

        // add factor list if not found
        if (IFactor(oneFactorContract).getFactorList(totalMinersInPool).length == 0) {
            IFactor(oneFactorContract).populateFactors(totalMinersInPool, totalMinersInPool.add(1));  
        }

        updatePool(_poolID);

        user.rewardDebt = user.amount.mul(pool.accIchiPerShare).div(10 ** 9);
        emit Deposit(msg.sender, _poolID, _amount);
        nonReentrant = false;
    }

    // Withdraw from ichiFarm
    function withdraw(uint256 _poolID) public {
        require(!nonReentrant, "ichiFarm::nonReentrant - try again");
        nonReentrant = true;

        PoolInfo storage pool = poolInfo[_poolID];
        UserInfo storage user = userInfo[_poolID][msg.sender];
        uint256 bonusToRealRatio = pool.bonusToRealRatio;

        updatePool(_poolID);

        uint256 pending = user.amount.mul(pool.accIchiPerShare).div(10 ** 9).sub(user.rewardDebt);
        if (pending > 0) {
            safeIchiTransfer(msg.sender, pending.mul(uint256(100).sub(bonusToRealRatio)).div(50));
        }
        if (user.bonusReward > 0) {
            safeIchiTransfer(msg.sender, uint256(user.bonusReward).mul(bonusToRealRatio).div(50));
            user.bonusReward = 0;
        }

        removeKeyValue(_poolID, bytes32(uint256(msg.sender)), user.amount); // remove current key
        playersInPool[_poolID] = playersInPool[_poolID].sub(1);

        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit Withdraw(msg.sender, _poolID, user.amount);
        user.amount = 0;

        user.rewardDebt = user.amount.mul(pool.accIchiPerShare).div(10 ** 9);
        nonReentrant = false;
    }

    // get rewards but no LP
    function claimRewards(uint256 _poolID) public {
        require(!nonReentrant, "ichiFarm::nonReentrant - try again");
        nonReentrant = true;

        PoolInfo storage pool = poolInfo[_poolID];
        UserInfo storage user = userInfo[_poolID][msg.sender];
        uint256 bonusToRealRatio = pool.bonusToRealRatio;

        updatePool(_poolID);

        uint256 pending = user.amount.mul(pool.accIchiPerShare).div(10 ** 9).sub(user.rewardDebt);
        if (pending > 0) {
            safeIchiTransfer(msg.sender, pending.mul(uint256(100).sub(bonusToRealRatio)).div(50));
        }
        if (user.bonusReward > 0) {
            safeIchiTransfer(msg.sender, uint256(user.bonusReward).mul(bonusToRealRatio).div(50));
            user.bonusReward = 0;
        }

        user.rewardDebt = user.amount.mul(pool.accIchiPerShare).div(10 ** 9);
        nonReentrant = false;
    }

    // Withdraw without caring about rewards.
    function emergencyWithdraw(uint256 _poolID) public {
        PoolInfo storage pool = poolInfo[_poolID];
        UserInfo storage user = userInfo[_poolID][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _poolID, user.amount);

        removeKeyValue(_poolID, bytes32(uint256(msg.sender)), user.amount); // remove current key
        user.amount = 0;
        user.rewardDebt = 0;
        user.bonusReward = 0;
    }

    // Safe ichi transfer function, just in case if rounding error causes pool to not have enough ICHIs.
    function safeIchiTransfer(address _to, uint256 _amount) internal {
        uint256 ichiBal = ichi.balanceOf(address(this));
        if (_amount > ichiBal) {
            ichi.transfer(_to, ichiBal);
        } else {
            ichi.transfer(_to, _amount);
        }
    }

    // finds the smallest block number cutoff that is <= total ranks in a given pool
    function findBlockNumberCutoff(uint256 _totalRanks, uint256 _currentBlockNumber) public pure returns (uint256) {
        uint256 modulo = 1000000;
        uint256 potentialCutoff = _currentBlockNumber % modulo;

        while (potentialCutoff > _totalRanks) {
            modulo = modulo.div(10);
            potentialCutoff = _currentBlockNumber % modulo;
        }

        return potentialCutoff;
    }

    // internal functions to call our sorted list
    function treeRootNode(uint256 _poolID) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.root;
    }

    function firstValue(uint256 _poolID) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.first();
    }

    function lastValue(uint256 _poolID) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.last();
    }

    function nextValue(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.next(value);
    }

    function prevValue(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.prev(value);
    }

    function valueExists(uint256 _poolID, uint256 value) public view returns (bool) {
        return poolInfo[_poolID].blockRank.exists(value);
    }

    function keyValueExists(uint256 _poolID, bytes32 key, uint256 value) public view returns (bool) {
        return poolInfo[_poolID].blockRank.keyExists(key, value);
    }

    function getNode(uint256 _poolID, uint256 value) public view returns (uint256, uint256, uint256, bool, uint256, uint256) {
        return poolInfo[_poolID].blockRank.getNode(value);
    }

    function getValueKeyLength(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.valueKeyAtIndexLength(value);
    }
    
    function getValueKey(uint256 _poolID, uint256 value, uint256 row) public view returns (address) {
        return address(uint160(uint256(poolInfo[_poolID].blockRank.valueKeyAtIndex(value,row))));
    }

    function getValueKeyRaw(uint256 _poolID, uint256 value, uint256 row) public view returns (bytes32) {
        return poolInfo[_poolID].blockRank.valueKeyAtIndex(value,row);
    }
    
    function valueKeyCount(uint256 _poolID) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.count();
    } 
    
    function valuePercentile(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.percentile(value);
    }
    
    function valuePermil(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.permil(value);
    }  
    
    function valueAtPercentile(uint256 _poolID, uint256 _percentile) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.atPercentile(_percentile);
    }
    
    function valueAtPermil(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.atPermil(value);
    }
    
    function medianValue(uint256 _poolID) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.median();
    }
    
    function valueRank(uint256 _poolID, uint256 value) public view returns (uint256) {
        require(valueExists(_poolID, value), "value must exist in tree");
        uint256 totalMinersInPool = playersInPool[_poolID];
        uint256 rawRank = poolInfo[_poolID].blockRank.rank(value);

        return totalMinersInPool.sub(rawRank.sub(1));
    }
    
    function valuesBelow(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.below(value);
    }
    
    function valuesAbove(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.above(value);
    }    

    function valueRankRaw(uint256 _poolID, uint256 value) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.rank(value);
    }

    function valueAtRankRaw(uint256 _poolID, uint256 _rank) public view returns (uint256) {
        return poolInfo[_poolID].blockRank.atRank(_rank);
    }

    function valueAtRank(uint256 _poolID, uint256 _rank) public view returns (uint256) {
        uint256 totalMinersInPool = playersInPool[_poolID];
        require(_rank <= totalMinersInPool, "rank must be less than or equal to the total miners in the pool");

        if (_rank <= totalMinersInPool && _rank > 0) {
            return poolInfo[_poolID].blockRank.atRank(totalMinersInPool.sub(_rank.sub(1)));
        } else {
            return 0;
        }
    }

    function insertKeyValue(uint256 _poolID, bytes32 key, uint256 value) private {
        emit Log("insert", key, value);
        poolInfo[_poolID].blockRank.insert(key, value);
    }
    function removeKeyValue(uint256 _poolID, bytes32 key, uint256 value) private {
        emit Log("delete", key, value);
        poolInfo[_poolID].blockRank.remove(key, value);
    }
}
