pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// stake ICHI to earn more ICHI (from trading fees)
// This contract handles swapping to and from xIchi, IchiSwap's staking token.
contract IchiStake is ERC20("IchiStake", "xICHI") {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    address public Ichi;

    uint256 private constant DECIMALS = 9;

    // Define the Ichi token contract
    constructor(address _Ichi) public {
        _setupDecimals(uint8(DECIMALS));
        Ichi = _Ichi;
    }

    // Locks Ichi and mints xIchi (shares)
    function enter(uint256 _amount) public {
        uint256 totalIchiLocked = IERC20(Ichi).balanceOf(address(this));
        uint256 totalShares = totalSupply(); // Gets the amount of xIchi in existence
        
        if (totalShares == 0 || totalIchiLocked == 0) { // If no xIchi exists, mint it 1:1 to the amount put in
            _mint(msg.sender, _amount);
        } else {
            uint256 xIchiAmount = _amount.mul(totalShares).div(totalIchiLocked);
            _mint(msg.sender, xIchiAmount);
        }
        // Lock the Ichi in the contract
        IERC20(Ichi).transferFrom(msg.sender, address(this), _amount);
    }

    // claim ICHI by burning xIchi
    function leave(uint256 _share) public {
        uint256 totalShares = totalSupply(); // Gets the amount of xIchi in existence

        uint256 ichiAmount = _share.mul(IERC20(Ichi).balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        IERC20(Ichi).transfer(msg.sender, ichiAmount);
    }
}