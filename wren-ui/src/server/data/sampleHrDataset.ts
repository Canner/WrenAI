import { RelationType } from '../types';
import { SampleDatasetName } from './type';
import type { SampleDataset } from './sampleTypes';

export const hrSampleDataset: SampleDataset = {
  name: SampleDatasetName.HR,
  tables: [
    {
      tableName: 'salaries',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/salaries.parquet',
      schema: [
        { columnName: 'emp_no', dataType: 'INTEGER' },
        { columnName: 'salary', dataType: 'INTEGER' },
        { columnName: 'from_date', dataType: 'DATE' },
        { columnName: 'to_date', dataType: 'DATE' },
      ],
      columns: [
        {
          name: 'emp_no',
          properties: {
            description: 'The employee number',
            displayName: 'emp_no',
          },
        },
        {
          name: 'salary',
          properties: {
            description: 'The salary of the employee.',
            displayName: 'salary',
          },
        },
        {
          name: 'from_date',
          properties: {
            description: 'The start date of the salary period.',
            displayName: 'from_date',
          },
        },
        {
          name: 'to_date',
          properties: {
            description: 'The end date of the salary period.',
            displayName: 'to_date',
          },
        },
      ],
      properties: {
        description:
          'Tracks the salary of employees, including the period during which each salary was valid.',
        displayName: 'salaries',
      },
    },
    {
      tableName: 'titles',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/titles.parquet',
      schema: [
        { columnName: 'emp_no', dataType: 'INTEGER' },
        { columnName: 'title', dataType: 'VARCHAR' },
        { columnName: 'from_date', dataType: 'DATE' },
        { columnName: 'to_date', dataType: 'DATE' },
      ],
      columns: [
        {
          name: 'emp_no',
          properties: {
            description: 'The employee number',
            displayName: 'emp_no',
          },
        },
        {
          name: 'title',
          properties: {
            description:
              'The title or position held by the employee. Limited to a maximum of 50 characters.',
            displayName: 'title',
          },
        },
        {
          name: 'from_date',
          properties: {
            description: 'The start date when the employee held this title',
            displayName: 'from_date',
          },
        },
        {
          name: 'to_date',
          properties: {
            description:
              'The end date when the employee held this title. This can be NULL if the employee currently holds the title.',
            displayName: 'to_date',
          },
        },
      ],
      properties: {
        description:
          'Tracks the titles (positions) held by employees, including the period during which they held each title.',
        displayName: 'titles',
      },
    },
    {
      tableName: 'dept_emp',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/dept_emp.parquet',
      schema: [
        { columnName: 'emp_no', dataType: 'INTEGER' },
        { columnName: 'dept_no', dataType: 'VARCHAR' },
        { columnName: 'from_date', dataType: 'DATE' },
        { columnName: 'to_date', dataType: 'DATE' },
      ],
      columns: [
        {
          name: 'emp_no',
          properties: {
            description: 'The employee number.',
            displayName: 'emp_no',
          },
        },
        {
          name: 'dept_no',
          properties: {
            description:
              'The department number the employee is associated with, referencing the dept_no in the departments table.',
            displayName: 'dept_no',
          },
        },
        {
          name: 'from_date',
          properties: {
            description:
              "The start date of the employee's association with the department.",
            displayName: 'from_date',
          },
        },
        {
          name: 'to_date',
          properties: {
            description:
              "The end date of the employee's association with the department",
            displayName: 'to_date',
          },
        },
      ],
      properties: {
        displayName: 'dept_emp',
      },
    },
    {
      tableName: 'departments',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/departments.parquet',
      schema: [
        { columnName: 'dept_name', dataType: 'VARCHAR' },
        { columnName: 'dept_no', dataType: 'VARCHAR' },
      ],
      columns: [
        {
          name: 'dept_name',
          properties: {
            description:
              'The name of the department. Limited to a maximum of 40 characters. This column is also unique across the table, ensuring no two departments share the same name',
            displayName: 'dept_name',
          },
        },
        {
          name: 'dept_no',
          properties: {
            description:
              'A unique identifier for each department. It serves as the primary key of the table.',
            displayName: 'dept_no',
          },
        },
      ],
      properties: {
        displayName: 'departments',
      },
    },
    {
      tableName: 'employees',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/employees.parquet',
      schema: [
        { columnName: 'birth_date', dataType: 'DATE' },
        { columnName: 'first_name', dataType: 'VARCHAR' },
        { columnName: 'last_name', dataType: 'VARCHAR' },
        { columnName: 'gender', dataType: 'VARCHAR' },
        { columnName: 'hire_date', dataType: 'DATE' },
        { columnName: 'emp_no', dataType: 'INTEGER' },
      ],
      columns: [
        {
          name: 'birth_date',
          properties: {
            description: 'The birth date of the employee.',
            displayName: 'birth_date',
          },
        },
        {
          name: 'first_name',
          properties: {
            description:
              'The first name of the employee. Limited to a maximum of 14 characters.',
            displayName: 'first_name',
          },
        },
        {
          name: 'last_name',
          properties: {
            description:
              'The last name of the employee. Limited to a maximum of 16 characters.',
            displayName: 'last_name',
          },
        },
        {
          name: 'gender',
          properties: {
            description:
              "The gender of the employee, with possible values 'M' (Male) or 'F' (Female).",
            displayName: 'gender',
          },
        },
        {
          name: 'hire_date',
          properties: {
            description: 'The date when the employee was hired.',
            displayName: 'hire_date',
          },
        },
        {
          name: 'emp_no',
          properties: {
            description:
              'A unique identifier for each employee. It serves as the primary key of the table',
            displayName: 'emp_no',
          },
        },
      ],
      properties: {
        description:
          'Stores basic information about employees such as their employee number, name, gender, birth date, and hire date',
        displayName: 'employees',
      },
    },
    {
      tableName: 'dept_manager',
      filePath:
        'https://assets.getwren.ai/sample_data/employees/dept_manager.parquet',
      schema: [
        { columnName: 'from_date', dataType: 'DATE' },
        { columnName: 'to_date', dataType: 'DATE' },
        { columnName: 'emp_no', dataType: 'INTEGER' },
        { columnName: 'dept_no', dataType: 'VARCHAR' },
      ],
      columns: [
        {
          name: 'from_date',
          properties: {
            description:
              'The start date of the employee’s managerial role in the department.',
            displayName: 'from_date',
          },
        },
        {
          name: 'to_date',
          properties: {
            description:
              'The end date of the employee’s managerial role in the department.',
            displayName: 'to_date',
          },
        },
        {
          name: 'emp_no',
          properties: {
            description: 'The employee number of the department manager',
            displayName: 'emp_no',
          },
        },
        {
          name: 'dept_no',
          properties: {
            description:
              'The department number that the manager is assigned to, referencing the dept_no in the departments table.',
            displayName: 'dept_no',
          },
        },
      ],
      properties: {
        description:
          'Tracks the assignment of managers to departments, including the period during which they managed a department',
        displayName: 'dept_manager',
      },
    },
  ],
  relations: [
    {
      fromModelName: 'employees',
      fromColumnName: 'emp_no',
      toModelName: 'titles',
      toColumnName: 'emp_no',
      type: RelationType.ONE_TO_MANY,
      description:
        'Each entry represents a title held by an employee during a specific time period.',
    },
    {
      fromModelName: 'departments',
      fromColumnName: 'dept_no',
      toModelName: 'dept_emp',
      toColumnName: 'dept_no',
      type: RelationType.ONE_TO_MANY,
    },
    {
      fromModelName: 'employees',
      fromColumnName: 'emp_no',
      toModelName: 'salaries',
      toColumnName: 'emp_no',
      type: RelationType.ONE_TO_MANY,
    },
    {
      fromModelName: 'dept_manager',
      fromColumnName: 'emp_no',
      toModelName: 'employees',
      toColumnName: 'emp_no',
      type: RelationType.MANY_TO_ONE,
    },
    {
      fromModelName: 'dept_emp',
      fromColumnName: 'emp_no',
      toModelName: 'employees',
      toColumnName: 'emp_no',
      type: RelationType.MANY_TO_ONE,
      description:
        'meaning an employee can be associated with multiple departments, titles, and salaries over time.',
    },
    {
      fromModelName: 'departments',
      fromColumnName: 'dept_no',
      toModelName: 'dept_manager',
      toColumnName: 'dept_no',
      type: RelationType.ONE_TO_MANY,
    },
  ],
  questions: [
    {
      question: 'What is the average salary for each position?',
      label: 'Aggregation',
    },
    {
      question:
        'Compare the average salary of male and female employees in each department.',
      label: 'Comparison',
    },
    {
      question:
        'What are the names of the managers and the departments they manage?',
      label: 'Associating',
    },
  ],
};
