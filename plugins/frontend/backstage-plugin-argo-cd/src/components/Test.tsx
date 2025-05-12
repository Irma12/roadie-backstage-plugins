import React, { useState, useMemo } from 'react';
import {
  InfoCard,
  OverflowTooltip,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/system';
import {
  DEFAULT_FRAGMENT_SOURCE,
  GetFragmentResult,
} from '@roadiehq/catalog-common';
import { EntityRefLinks, useEntity } from '@backstage/plugin-catalog-react';
import {
  Entity,
  EntityRelation,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { groupBy } from 'lodash';
import startCase from 'lodash/startCase';
import MaterialReactTable, {
  MRT_ColumnDef,
  MRT_Row,
} from 'material-react-table';
import { ActionsColumn, ActionsColumnType } from '../table';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import {
  createTheme,
  ThemeOptions,
  ThemeProvider,
  useTheme,
} from '@mui/material/styles';
import { ShadowOverlayWrapper } from '../effects';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import {
  roadieEntityFragmentCreatePermission,
  roadieEntityFragmentDeletePermission,
  roadieEntityFragmentUpdatePermission,
} from '@roadiehq/permission-common';
import { useFeatureFlags } from '@roadiehq/shared-hooks';
import { fragmentApiRef } from '../../apis';
import Grid from '@mui/material/Grid';
import Add from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogContent from '@mui/material/DialogContent';
import Dialog from '@mui/material/Dialog';
import { NewRelationsForm } from './NewRelationsForm';
import Tooltip from '@mui/material/Tooltip';
import { RelatedEntity, useRelatedEntities } from '../../hooks';
import pMap from 'p-map';

const RELATIONSHIP_ALL = 'all';

const relationshipKeysMap = [
  ['partOf', 'hasPart'],
  ['dependencyOf', 'dependsOn'],
  ['parentOf', 'childOf'],
  ['ownerOf', 'ownedBy'],
  ['memberOf', 'members'],
  ['providesApi', 'apiProvidedBy'],
  ['consumesApi', 'apiConsumedBy'],
  ['manages', 'managedBy'],
  ['memberOf', 'hasMember'],
];

const Subtitle = styled(CardHeader)({
  '& span:last-child': {
    paddingBottom: '0px',
  },
});

export const EntityRelationsCard = ({
  title,
  subHeader = '',
  relation = RELATIONSHIP_ALL,
  hiddenColumns = [],
}: {
  title?: string;
  subHeader?: string;
  relation: string;
  hiddenColumns?: string[];
}) => {
  const { entity } = useEntity();
  const entityRef = stringifyEntityRef(entity);
  const {
    entities,
    loading: loadingEntities,
    error: entitiesFetchError,
  } = useRelatedEntities(entity, {
    ...(relation !== RELATIONSHIP_ALL && { type: relation }),
  });

  const [fragmentSources, setFragmentSources] =
    useState<Record<string, GetFragmentResult>>();
  const [openModal, setOpenModal] = useState<boolean>(false);

  const theme = useTheme();
  const fragmentApi = useApi(fragmentApiRef);
  const { allowed: updateDecoratorAllowed } = usePermission({
    permission: roadieEntityFragmentUpdatePermission,
  });
  const { allowed: createDecoratorAllowed } = usePermission({
    permission: roadieEntityFragmentCreatePermission,
  });
  const { allowed: deleteDecoratorAllowed } = usePermission({
    permission: roadieEntityFragmentDeletePermission,
  });

  const { getFeatureFlag } = useFeatureFlags();
  const isDecorationEnabled = getFeatureFlag(
    'relationship-card-decoration',
    false,
  );

  useAsync(async () => {
    const mainEntity = stringifyEntityRef(entity);
    const fragments = await fragmentApi.list({
      entityRef: mainEntity,
      source: DEFAULT_FRAGMENT_SOURCE,
    });

    if (entities) {
      const resolvedLeafFragments = await pMap(
        entities,
        async (e: RelatedEntity) => {
          const ref = stringifyEntityRef(e as Entity);
          const leafFragments = await fragmentApi.list({
            entityRef: ref,
            source: DEFAULT_FRAGMENT_SOURCE,
          });
          if (leafFragments.items.length > 0) {
            return { ref, fragment: fragments.items[0] };
          }
          return null;
        },
        { concurrency: 10 },
      );

      const updatedFragmentSources = resolvedLeafFragments.reduce(
        (acc, item) => {
          if (item) {
            acc[item.ref] = item.fragment;
          }
          return acc;
        },
        {} as Record<string, GetFragmentResult>,
      );

      setFragmentSources(prevState => ({
        ...prevState,
        ...updatedFragmentSources,
      }));
    } else if (fragments.items.length > 0) {
      setFragmentSources(prevState => ({
        ...prevState,
        [mainEntity]: fragments.items[0],
      }));
    } else {
      setFragmentSources({});
    }
  }, [fragmentApi, entity, entities]);

  const entitiesByKind = useMemo(() => groupBy(entities, 'kind'), [entities]);
  const singleKind = useMemo(
    () => Object.keys(entitiesByKind).length === 1,
    [entitiesByKind],
  );

  const columns = useMemo(() => {
    const hiddenColumnsSet = new Set(hiddenColumns);
    let cols: MRT_ColumnDef<Entity>[] = [
      {
        header: 'Name',
        size: 100,
        accessorKey: 'metadata.name',
        Cell: ({ row, renderedCellValue }) => {
          const ref = stringifyEntityRef(row.original);
          return (
            <Tooltip title={renderedCellValue} enterDelay={5000}>
              <EntityRefLinks entityRefs={[ref]}>
                {renderedCellValue}
              </EntityRefLinks>
            </Tooltip>
          );
        },
      },
      {
        header: 'Description',
        accessorKey: 'metadata.description',
        Cell: ({ renderedCellValue, row }) =>
          row.original.metadata.description &&
          row.original.metadata.description.length > 20 ? (
            <OverflowTooltip
              text={row.original.metadata.description}
              placement="bottom-start"
            />
          ) : (
            renderedCellValue
          ),
      },
      {
        header: 'Owner',
        size: 100,
        accessorKey: 'spec.owner',
        enableHiding: false,
        Cell: ({ row, renderedCellValue }) => {
          if (row.original.spec?.owner) {
            if ((row.original.spec.owner as string).includes(':')) {
              return (
                <EntityRefLinks
                  entityRefs={[row.original.spec.owner as string]}
                  defaultKind="group"
                >
                  {renderedCellValue}
                </EntityRefLinks>
              );
            }
            return (
              <EntityRefLinks
                entityRefs={[`group:${row.original.spec.owner as string}`]}
                defaultKind="group"
              >
                {renderedCellValue}
              </EntityRefLinks>
            );
          }
          return null;
        },
      },
      {
        header: 'Type',
        size: 80,
        accessorKey: 'spec.type',
      },
    ];

    if (relation === RELATIONSHIP_ALL) {
      cols = [
        ...cols.slice(0, 1),
        {
          header: 'Relation',
          id: 'relation',
          size: 100,
          Cell: ({ row }) => {
            const rel = row.original.relations?.find(
              (r: EntityRelation) => r.targetRef === stringifyEntityRef(entity),
            )?.type;
            const pair = relationshipKeysMap.find(
              r => r[0] === rel || r[1] === rel,
            );
            const inverse = pair && rel === pair[0] ? pair[1] : pair?.[0];
            return <Typography>{inverse || 'unknown'}</Typography>;
          },
        },
        ...cols.slice(1),
      ];
    }

    if (isDecorationEnabled) {
      cols.push({
        id: 'actions',
        enableEditing: false,
        header: 'Actions',
        size: 80,
        enableColumnOrdering: false,
        enableHiding: false,
        enableResizing: false,
        enableColumnActions: false,
        Cell: ({ row }: { row: MRT_Row<Entity> }) => {
          const rowEntityRef = stringifyEntityRef(row.original);
          const fragmentSource = fragmentSources?.[rowEntityRef];
          const disabled = !fragmentSource || !deleteDecoratorAllowed;
          const buttons: ActionsColumnType[] = [
            {
              name: 'Delete',
              tooltip: 'Delete',
              icon: <DeleteOutlineIcon fontSize="small" color="inherit" />,
              disabled,
              onClick: () => {},
            },
          ];
          return <ActionsColumn actions={buttons} />;
        },
      });
    }

    return cols.filter(c => !hiddenColumnsSet.has(c.header));
  }, [
    hiddenColumns,
    relation,
    fragmentSources,
    entity,
    deleteDecoratorAllowed,
    isDecorationEnabled,
  ]);

  const getTitle = () =>
    relation === RELATIONSHIP_ALL
      ? title || 'Relations'
      : title || startCase(relation);
  const resolvedTitle = getTitle();

  if (loadingEntities || !fragmentSources) {
    return (
      <Card>
        <Subtitle title={resolvedTitle} subheader={subHeader} />
        <Divider />
        <CardContent>
          <Progress />
        </CardContent>
      </Card>
    );
  }

  if (entitiesFetchError) {
    return (
      <InfoCard variant="gridItem" title={resolvedTitle}>
        <ResponseErrorPanel error={entitiesFetchError} />
      </InfoCard>
    );
  }

  if (entities?.length === 0) {
    return (
      <Card>
        <Subtitle title={resolvedTitle} subheader={subHeader} />
        <Divider />
        <CardContent>
          No Entities with relation type {relation} found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Subtitle title={resolvedTitle} subheader={subHeader} />
      <Divider />
      <CardContent sx={{ padding: singleKind ? '1em 0 0 1em' : undefined }}>
        {Object.entries(entitiesByKind).map(entry => (
          <React.Fragment key={entry[0]}>
            <ThemeProvider theme={createTheme(theme as ThemeOptions)}>
              <ShadowOverlayWrapper enableActionsShadow>
                {({ tableInstanceRef, materialReactTableStyleOverrides }) => (
                  <Box pt={2} pb={2}>
                    <Typography variant="h6">{entry[0]}</Typography>
                    <MaterialReactTable
                      initialState={{
                        density: 'compact',
                        columnPinning: { right: ['actions'] },
                        pagination: {
                          pageSize: singleKind ? 10 : 5,
                          pageIndex: 0,
                        },
                      }}
                      data={entry[1]}
                      columns={columns}
                      enableRowVirtualization
                      layoutMode="grid"
                      enablePagination
                      positionPagination="bottom"
                      enableSorting={false}
                      enableTopToolbar={false}
                      enableColumnResizing
                      enableColumnActions={false}
                      enableFilters={false}
                      enableColumnFilters={false}
                      enableBottomToolbar={entry[1].length > 5}
                      {...materialReactTableStyleOverrides}
                      tableInstanceRef={tableInstanceRef}
                    />
                  </Box>
                )}
              </ShadowOverlayWrapper>
            </ThemeProvider>
            {!singleKind && <Divider />}
          </React.Fragment>
        ))}
        <Dialog
          maxWidth="md"
          open={openModal}
          onClose={() => setOpenModal(prevState => !prevState)}
          fullWidth
        >
          <DialogContent>
            <Grid item xs={12}>
              <Box padding={1}>
                <NewRelationsForm
                  entityRef={entityRef}
                  setOpenModal={setOpenModal}
                />
              </Box>
            </Grid>
          </DialogContent>
        </Dialog>
        {isDecorationEnabled && (
          <Grid container item justifyContent="flex-end">
            <Box mt={4}>
              {!updateDecoratorAllowed || !createDecoratorAllowed ? (
                <Tooltip title="You don't have permission to do this">
                  <span>
                    <Button
                      color="primary"
                      className="array-item-add"
                      startIcon={<Add />}
                      onClick={() => setOpenModal(prevState => !prevState)}
                      disabled
                    >
                      Add Relation
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  color="primary"
                  className="array-item-add"
                  startIcon={<Add />}
                  onClick={() => setOpenModal(prevState => !prevState)}
                >
                  Add Relation
                </Button>
              )}
            </Box>
          </Grid>
        )}
      </CardContent>
    </Card>
  );
};
