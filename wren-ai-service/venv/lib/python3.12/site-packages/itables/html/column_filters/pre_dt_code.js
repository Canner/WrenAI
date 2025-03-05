// Setup - add a text input to each header or footer cell
$('#table_id:not(.dataTable) thead_or_tfoot th').each(function () {
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search " + $(this).text();

    $(this).html(input);
});
