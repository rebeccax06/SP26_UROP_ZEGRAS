"""
CLI entry point for the LTS pipeline.

`main.py <command>` dispatches to one of three subcommands:
    process   Download OSM + compute LTS for a city (or list of cities)
    plot      Export GeoJSON for an existing LTS dataset
    combine   Concatenate per-city LTS CSVs into a region-wide file

Run `python main.py <command> -h` for that subcommand's flags.
Intermediate files live in `data/`; delete one to force re-computation
from that step onward.
"""
import argparse
import sys

import constants


def plot_func(args, cities=None):
    """Render a single city or every city in `cities` to GeoJSON."""
    # Imported lazily so argparse `--help` stays snappy.
    import LTS_plot

    if args.city:
        print(f'Plotting {args.city}')
        LTS_plot.main(args.city, args.format)
        return

    for city in cities or ():
        try:
            print(f'Plotting {city}')
            LTS_plot.main(city, args.format)
        except FileNotFoundError as e:
            print(f'\t{e}')


def combine_func(args):
    """Combine per-city LTS CSVs (named in `args.cities`) into `GreaterBoston_4_all_lts.csv`."""
    import LTS_OSM

    LTS_OSM.combine_data('GreaterBoston', args.cities.split(','))


class StressMapCli:
    """Top-level argparse-based dispatcher. Subcommand methods do their own parsing."""

    def __init__(self):
        parser = argparse.ArgumentParser(
            description='StressMap LTS tool for calculating and plotting bike stress',
            usage='''
                main.py <command> [<args>]
                The most commonly used commands are:
                    process      Download OSM and compute LTS for a city (or cities)
                    plot         Plot a single city, a list of cities, or a whole region
                    combine      Create a combined map from all cities analyzed
                    help         Show this help message
            ''',
        )
        parser.add_argument('command', help='Subcommand to run')
        args = parser.parse_args(sys.argv[1:2])
        if not hasattr(self, args.command):
            print('Unrecognized command')
            parser.print_help()
            exit(1)
        getattr(StressMapCli, args.command)()

    @staticmethod
    def process():
        """Fetch OSM data and compute LTS for one or more cities."""
        parser = argparse.ArgumentParser(description='Fetch and process OSM data into LTS')
        parser.add_argument("-cities", type=str, help="Comma-separated list of cities")
        parser.add_argument("-city", type=str, help="Single city to process")
        parser.add_argument("--rebuild", action="store_true", help="Rebuild underlying data")
        parser.add_argument("--combine", action="store_true",
                            help="Combine directly after processing")
        parser.add_argument("--plot", action="store_true",
                            help="Plot directly after processing")
        args = parser.parse_args(sys.argv[2:])

        cities = constants.CITIES
        if args.cities and args.city:
            raise ValueError("Cannot specify both --cities and --city")
        if not args.cities and not args.city:
            raise ValueError("Must specify either --cities or --city")

        import LTS_OSM

        targets = args.cities.split(',') if args.cities else [args.city]
        for city in targets:
            LTS_OSM.main(city, cities[city]['key'], cities[city]['value'], args.rebuild)

        if args.combine:
            combine_func(args)
            if args.plot:
                args.format = 'json'
                args.city = 'GreaterBoston'
                plot_func(args)
        elif args.plot:
            args.format = 'json'
            if args.cities:
                args.city = None
                plot_func(args, cities)
            else:
                plot_func(args)

    @staticmethod
    def plot():
        """Plot existing local LTS data to GeoJSON."""
        parser = argparse.ArgumentParser(
            description='Plot existing local LTS data to GeoJSON'
        )
        parser.add_argument("-city", type=str, help="Single city to plot")
        parser.add_argument("-cities", type=str, help="Comma-separated list of cities")
        parser.add_argument("--format", choices=["json"], default="json",
                            help="Output format")
        args = parser.parse_args(sys.argv[2:])

        if args.cities:
            args.city = None
            plot_func(args, args.cities.split(','))
        else:
            plot_func(args)

    @staticmethod
    def combine():
        """Concatenate per-city LTS CSVs into one regional file."""
        parser = argparse.ArgumentParser(
            description='Combine per-city LTS CSVs into a region-wide file'
        )
        parser.add_argument("-cities", type=str, required=True,
                            help="Comma-separated list of cities")
        args = parser.parse_args(sys.argv[2:])
        combine_func(args)


if __name__ == '__main__':
    StressMapCli()
