// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title HBToken
 * @notice Minimal ERC20 token implementation with minting capabilities.  The
 * Hummingbird contract will accumulate rewards in internal accounting and
 * call `mint` on this token to distribute HB tokens when users claim
 * rewards.  The contract owner can designate a `minter` address that
 * possesses the authority to mint new tokens.
 */
contract HBToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    /// Owner of the token contract.  Can update the minter.
    address public owner;
    /// Address authorized to mint new tokens.
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        minter = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    /// Change the minter address.  Only callable by the token owner.
    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "zero minter");
        minter = _minter;
    }

    /// Mint new tokens to the given address.  Only callable by the minter.
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance exceeded");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero recipient");
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "zero recipient");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}