.PHONY: test lint

test:
	bats test/

lint:
	shellcheck core/*.sh test/*.bats test/gh
