"""Validate Python service configuration without printing values or contacting providers."""

from workbench.config import ConfigurationError, configuration_status, settings


def main():
    try:
        configured = settings()
    except ConfigurationError as exc:
        print(str(exc))
        return 1
    print('PASS: required service configuration is valid')
    for notice in configuration_status(configured)['notices']:
        print('NOTICE: ' + notice)
    print('No connectivity, credentials, provider access or model quality was tested.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
