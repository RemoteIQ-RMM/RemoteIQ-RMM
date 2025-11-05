//remoteiq-frontend\components\data-table.tsx

"use client";

import * as React from "react";
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    SortingState,
    VisibilityState,
    ColumnFiltersState,
    RowSelectionState,
    useReactTable,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableHeader,
    TableHead,
    TableRow,
    TableBody,
    TableCell,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";

type ColumnMeta = { headerClassName?: string; cellClassName?: string };

export type TableSnapshot = {
    sorting: SortingState;
    columnVisibility: VisibilityState;
    columnFilters: ColumnFiltersState;
    pagination: { pageIndex: number; pageSize: number };
};

export type DataTableProps<TData extends { id?: string }, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];

    filterColumn?: string;
    filterInputPlaceholder?: string;

    sorting: SortingState;
    setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
    columnVisibility: VisibilityState;
    setColumnVisibility: React.Dispatch<React.SetStateAction<VisibilityState>>;
    columnFilters: ColumnFiltersState;
    setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;

    rowSelection?: RowSelectionState;
    setRowSelection?: React.Dispatch<React.SetStateAction<RowSelectionState>>;

    compact?: boolean;

    // Saved Views plumbing + styling
    className?: string;
    /** Register a function that returns the current table snapshot (used by Saved Views). */
    registerSnapshotGetter?: (fn: () => TableSnapshot) => void;
    /** Optional: notify parent whenever table state changes. */
    onTableStateChange?: (snap: TableSnapshot) => void;
};

export function DataTable<TData extends { id?: string }, TValue>({
    columns,
    data,
    filterColumn,
    filterInputPlaceholder = "Filter…",
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
    columnFilters,
    setColumnFilters,
    rowSelection,
    setRowSelection,
    compact = false,
    className,
    registerSnapshotGetter,
    onTableStateChange,
}: DataTableProps<TData, TValue>) {
    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnVisibility,
            columnFilters,
            rowSelection: rowSelection ?? {},
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnFiltersChange: setColumnFilters,
        enableRowSelection: !!setRowSelection,
        onRowSelectionChange: setRowSelection,
        getRowId: (row: any, index) => (row?.id ? String(row.id) : String(index)),
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
    });

    // ---- Saved Views snapshot getter (FUNCTION, not value) ----
    const getSnapshot = React.useCallback<() => TableSnapshot>(() => {
        const s = table.getState();
        return {
            sorting: s.sorting,
            columnVisibility: s.columnVisibility,
            columnFilters: s.columnFilters,
            pagination: {
                pageIndex: s.pagination.pageIndex,
                pageSize: s.pagination.pageSize,
            },
        };
    }, [table]);

    // Register getter with consumer (e.g., DashboardContext)
    React.useEffect(() => {
        if (registerSnapshotGetter) registerSnapshotGetter(getSnapshot);
    }, [registerSnapshotGetter, getSnapshot]);

    // Notify consumer when state changes (for autosave/dirty indicators)
    const pageIndex = table.getState().pagination.pageIndex;
    const pageSize = table.getState().pagination.pageSize;
    React.useEffect(() => {
        if (onTableStateChange) onTableStateChange(getSnapshot());
    }, [sorting, columnVisibility, columnFilters, pageIndex, pageSize, onTableStateChange, getSnapshot]);

    const globalFilterValue =
        filterColumn ? ((table.getColumn(filterColumn)?.getFilterValue() as string) ?? "") : "";

    return (
        <div className={cn("space-y-3 min-w-0", className)}>
            {/* Toolbar */}
            <div className="flex items-center gap-2 min-w-0">
                {filterColumn ? (
                    <div className="relative">
                        <Input
                            value={globalFilterValue}
                            onChange={(e) => table.getColumn(filterColumn)?.setFilterValue(e.target.value)}
                            placeholder={filterInputPlaceholder}
                            className="w-[240px] md:w-[320px]"
                            aria-label="Filter rows"
                        />
                    </div>
                ) : null}

                <div className="ml-auto" />

                {/* Columns visibility (stay open while toggling) */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2" title="Show/hide columns">
                            <SlidersHorizontal className="h-4 w-4" />
                            Columns
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {table
                            .getAllLeafColumns()
                            .filter((col) => col.getCanHide?.() ?? true)
                            .map((col) => (
                                <DropdownMenuCheckboxItem
                                    key={col.id}
                                    checked={col.getIsVisible()}
                                    onCheckedChange={(checked) => col.toggleVisibility(!!checked)}
                                    onSelect={(e) => e.preventDefault()} // keep open for multi-toggle
                                    className="capitalize"
                                >
                                    {col.columnDef.header
                                        ? String(
                                            typeof col.columnDef.header === "string"
                                                ? col.columnDef.header
                                                : col.id.replace(/[_-]/g, " "),
                                        )
                                        : col.id.replace(/[_-]/g, " ")}
                                </DropdownMenuCheckboxItem>
                            ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Table */}
            <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed">
                    <TableHeader>
                        {table.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id}>
                                {hg.headers.map((header) => {
                                    const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                                    return (
                                        <TableHead key={header.id} className={cn("truncate", meta?.headerClassName)}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>

                    <TableBody>
                        {table.getRowModel().rows.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() ? "selected" : undefined}
                                    className={cn("hover:bg-accent/40", compact ? "[&>td]:py-2" : "[&>td]:py-3")}
                                >
                                    {row.getVisibleCells().map((cell) => {
                                        const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                                        return (
                                            <TableCell key={cell.id} className={cn("truncate", meta?.cellClassName)}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-end gap-2">
                <div className="text-xs text-muted-foreground">
                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    aria-label="Previous page"
                    title="Previous page"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    aria-label="Next page"
                    title="Next page"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
