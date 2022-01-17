module.exports = {
	"**/*": [() => "pnpm run -r precommit --", () => "prettier --write ."],
};
